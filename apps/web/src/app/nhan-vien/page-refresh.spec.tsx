// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

// Wave 96B (Mini ↔ web, Wave 76A/80A): lệnh ghi lịch ca của nhân viên giữ khoá tới khi danh sách ca mới về, có hạn 4 giây; lệnh bị từ chối vì ca đã
// đổi trạng thái (400/404/409) thì tải lại đúng tuần của lệnh; lệnh có ô nhập (thêm/sửa/đăng ký nhanh/huỷ ca) chỉ tải lại ở 404/409, còn 400 là lỗi nhập
// hiện lời lỗi. Mini chỉ `invalidate()` không chờ, web chặt hơn có chủ ý.

type Call = { method: string; path: string; body?: unknown; query?: Record<string, string> };
type Gate = { path: string; promise: Promise<unknown> };

const m = vi.hoisted(() => ({
  calls: [] as Call[],
  data: {} as Record<string, unknown>,
  gates: [] as Gate[],
  write: {} as Record<string, () => unknown>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { role: 'STAFF' } }) }));
vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
vi.mock('@/lib/core-http', () => {
  const run = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
    m.calls.push({ method, path, body, query });
    if (method === 'GET') {
      for (const g of m.gates.filter((x) => x.path === path)) await g.promise;
      if (!(path in m.data)) throw new Error(`chưa mock ${path}`);
      return m.data[path];
    }
    const h = m.write[`${method} ${path}`];
    return h ? h() : {};
  };
  return {
    coreHttp: {
      get: (path: string, opts?: { query?: Record<string, string> }) => run('GET', path, undefined, opts?.query),
      post: (path: string, body?: unknown) => run('POST', path, body),
      patch: (path: string, body?: unknown) => run('PATCH', path, body),
      put: (path: string, body?: unknown) => run('PUT', path, body),
      delete: (path: string) => run('DELETE', path),
    },
  };
});

import StaffPage from './page';

// 11/03/2026 12:00 giờ VN (Thứ 4): tuần 09/03–15/03, "hôm nay" = 11/03.
const NOW = '2026-03-11T05:00:00Z';
const WEEK0_FROM = '2026-03-09T00:00:00.000Z';
const WEEK1_FROM = '2026-03-16T00:00:00.000Z';
const vn = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+07:00`).toISOString();
const TEMPLATES = [{ id: 't1', name: 'Ca sáng', startMin: 480, endMin: 720, active: true, sortOrder: 1 }];
const shift = (id: string, day: string, status: string) => ({
  id,
  staffId: 'u1',
  workDate: `${day}T00:00:00.000Z`,
  startAt: vn(day, '08:00'),
  endAt: vn(day, '12:00'),
  templateId: null,
  status,
  approvedStart: null,
  approvedEnd: null,
  rejectReason: null,
  cancelReason: null,
  isEmergency: false,
  evidenceUrl: null,
  cancelPenalty: false,
});
const SHIFTS = () => [shift('sp', '2026-03-12', 'PENDING'), shift('sa', '2026-03-13', 'APPROVED')];

/** Mọi lần GET `path` kể từ lúc gọi hàm này bị giữ tới khi gọi `release()`; không gọi thì treo mãi. */
const holdGet = (path: string) => {
  let resolve!: () => void;
  const gate: Gate = { path, promise: new Promise<void>((r) => (resolve = r)) };
  m.gates.push(gate);
  return {
    release: () => {
      m.gates.splice(m.gates.indexOf(gate), 1);
      resolve();
    },
  };
};
const reject = (status: number, message: string) => () => {
  throw new ApiError(message, status);
};

beforeAll(async () => {
  await import('@/components/mini/empty-state');
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<StaffPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
const nameOf = (b: Element) => (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim();
const btn = (name: string | RegExp) => buttons().find((b) => (typeof name === 'string' ? nameOf(b) === name : name.test(nameOf(b))))!;
const calls = (method: string, path: string) => m.calls.filter((c) => c.method === method && c.path === path);
const weekGets = (from = WEEK0_FROM) => calls('GET', '/staff/shifts').filter((c) => c.query?.from === from);
const busy = (el: HTMLElement) => el.getAttribute('aria-busy') === 'true';
const alerts = () => Array.from(document.querySelectorAll('[role="alert"]')).map((a) => a.textContent ?? '').join(' | ');
const press = async (name: string | RegExp) => {
  click(btn(name));
  await flush(6);
};
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const useHangTimers = () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(NOW));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  m.calls = [];
  m.gates = [];
  m.write = {};
  m.data = {
    '/staff/attendance/status': { shifts: [], openSession: null },
    '/staff/shift-templates': TEMPLATES,
    '/staff/shifts': SHIFTS(),
  };
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.useRealTimers();
});

interface Command {
  name: string;
  writeKey: string;
  /** Lệnh có ô người dùng nhập/chọn (giờ, lý do, ảnh): 400 là lỗi nhập liệu, không phải ca đã cũ. */
  input: boolean;
  /** Mở tấm (nếu cần) và bấm gửi. */
  fire: () => Promise<void>;
  /** Nút luôn thấy được báo bận trong lúc lệnh còn giữ khoá. */
  busyEl: () => HTMLButtonElement;
  paths: () => number;
}

const COMMANDS: Command[] = [
  {
    name: 'Thêm ca',
    input: true,
    writeKey: 'POST /staff/shifts',
    fire: async () => {
      await press('Thêm ca T4 11/03');
      click(btn('Ca sáng (08:00–12:00)'));
      click(btn(/^(Gửi duyệt|Đang gửi…)$/));
      await flush(6);
    },
    busyEl: () => btn('Thêm ca T4 11/03'),
    paths: () => calls('POST', '/staff/shifts').length,
  },
  {
    name: 'Sửa ca',
    input: true,
    writeKey: 'PATCH /staff/shifts/sp',
    fire: async () => {
      await press('Sửa ca T5 12/03');
      typeInto(document.querySelectorAll<HTMLInputElement>('input[type="time"]')[1]!, '11:30');
      click(btn(/^(Lưu|Đang gửi…)$/));
      await flush(6);
    },
    busyEl: () => btn('Sửa ca T5 12/03'),
    paths: () => calls('PATCH', '/staff/shifts/sp').length,
  },
  {
    name: 'Xoá ca',
    input: false,
    writeKey: 'DELETE /staff/shifts/sp',
    fire: async () => {
      await press('Xoá ca T5 12/03');
    },
    busyEl: () => btn('Xoá ca T5 12/03'),
    paths: () => calls('DELETE', '/staff/shifts/sp').length,
  },
  {
    name: 'Đăng ký nhanh',
    input: true,
    writeKey: 'POST /staff/shifts',
    fire: async () => {
      await press('Đăng ký ca');
      click(btn(/^Gửi duyệt \(\d+ ngày\)$/));
      await flush(6);
    },
    busyEl: () => btn('Đăng ký ca'),
    paths: () => calls('POST', '/staff/shifts').length,
  },
  {
    name: 'Chép tuần trước',
    input: false,
    writeKey: 'POST /staff/shifts/copy-week',
    fire: async () => {
      await press('Chép tuần trước');
    },
    busyEl: () => btn('Chép tuần trước'),
    paths: () => calls('POST', '/staff/shifts/copy-week').length,
  },
  {
    name: 'Huỷ ca đã duyệt',
    input: true,
    writeKey: 'POST /staff/shifts/sa/cancel',
    fire: async () => {
      await press('Huỷ ca T6 13/03');
      typeInto(document.querySelector<HTMLTextAreaElement>('textarea')!, 'Bận việc nhà');
      click(btn(/^(Xác nhận huỷ|Đang huỷ…)$/));
      await flush(6);
    },
    busyEl: () => btn('Huỷ ca T6 13/03'),
    paths: () => calls('POST', '/staff/shifts/sa/cancel').length,
  },
];

describe.each(COMMANDS)('/nhan-vien — $name: giữ khoá tới khi danh sách ca về, có hạn 4 giây', (cmd) => {
  it('danh sách ca không bao giờ về: còn bận ở 3,5 giây và chạm lại không gửi lệnh thứ hai; nhả sau hạn 4 giây', async () => {
    useHangTimers();
    await mount();
    holdGet('/staff/shifts');
    await cmd.fire();
    expect(cmd.paths()).toBe(1);
    await advance(3_500);
    expect(busy(cmd.busyEl())).toBe(true);
    click(cmd.busyEl());
    await flush();
    expect(cmd.paths()).toBe(1);
    await advance(700);
    expect(busy(cmd.busyEl())).toBe(false);
  });

  it('bị từ chối 400: lệnh không có ô nhập thì tải lại đúng tuần của lệnh và giữ khoá tới khi danh sách về; lệnh có ô nhập (lỗi nhập liệu) thì hiện lỗi, KHÔNG tải lại, nhả khoá ngay', async () => {
    m.write[cmd.writeKey] = reject(400, 'Ca đã đổi trạng thái, tải lại nhé.');
    await mount();
    const before = weekGets().length;
    const gate = holdGet('/staff/shifts');
    await cmd.fire();
    expect(cmd.paths()).toBe(1);
    expect(alerts()).toContain('Ca đã đổi trạng thái, tải lại nhé.');
    if (cmd.input) {
      expect(weekGets()).toHaveLength(before);
      expect(busy(cmd.busyEl())).toBe(false);
    } else {
      expect(weekGets()).toHaveLength(before + 1);
      expect(busy(cmd.busyEl())).toBe(true);
    }
    gate.release();
    await flush();
    expect(busy(cmd.busyEl())).toBe(false);
  });

  it('bị từ chối 404 hoặc 409 cũng tải lại danh sách', async () => {
    for (const status of [404, 409]) {
      m.calls = [];
      m.write[cmd.writeKey] = reject(status, 'Ca không còn như trước.');
      const r = await mount();
      const before = weekGets().length;
      const gate = holdGet('/staff/shifts');
      await cmd.fire();
      expect(alerts()).toContain('Ca không còn như trước.');
      expect(weekGets()).toHaveLength(before + 1);
      gate.release();
      await flush();
      r.unmount();
      mounted = [];
      document.body.innerHTML = '';
    }
  });

  it('lỗi 500 hoặc mất mạng: hiện lỗi, KHÔNG tải lại danh sách, nhả khoá ngay', async () => {
    m.write[cmd.writeKey] = reject(500, 'Máy chủ lỗi');
    await mount();
    const before = weekGets().length;
    await cmd.fire();
    expect(alerts()).toContain('Máy chủ đang bận');
    expect(weekGets()).toHaveLength(before);
    expect(busy(cmd.busyEl())).toBe(false);
  });
});

describe('/nhan-vien — bị từ chối mà tải lại treo', () => {
  it('Xoá ca bị từ chối 400, danh sách không về: vẫn nhả khoá sau hạn 4 giây', async () => {
    useHangTimers();
    m.write['DELETE /staff/shifts/sp'] = reject(400, 'Ca đã được duyệt, tải lại nhé.');
    await mount();
    holdGet('/staff/shifts');
    await press('Xoá ca T5 12/03');
    await advance(3_500);
    expect(busy(btn('Xoá ca T5 12/03'))).toBe(true);
    await advance(700);
    expect(busy(btn('Xoá ca T5 12/03'))).toBe(false);
  });
});

describe('/nhan-vien — Xoá ca đã được duyệt ở máy khác', () => {
  it('lời lỗi còn sau khi tải lại làm ca đổi trạng thái: nút Xoá biến mất, ca hiện "Đã duyệt", cảnh báo vẫn ở đó', async () => {
    m.write['DELETE /staff/shifts/sp'] = reject(400, 'Chỉ xoá được ca đang chờ duyệt.');
    await mount();
    const gate = holdGet('/staff/shifts');
    m.data['/staff/shifts'] = [shift('sp', '2026-03-12', 'APPROVED'), shift('sa', '2026-03-13', 'APPROVED')];
    await press('Xoá ca T5 12/03');
    gate.release();
    await flush();
    expect(btn('Xoá ca T5 12/03')).toBeUndefined();
    expect(btn('Huỷ ca T5 12/03')).toBeDefined();
    expect(alerts()).toContain('Chỉ xoá được ca đang chờ duyệt.');
  });
});

describe('/nhan-vien — số dùng tabular-nums', () => {
  it('giờ ca trong lịch tuần', async () => {
    await mount();
    const time = Array.from(document.querySelectorAll('div')).find((d) => /^08:00 – 12:00/.test(d.textContent ?? '') && d.children.length <= 1);
    expect(time).toBeDefined();
    expect(time!.classList.contains('tabular-nums')).toBe(true);
  });

  it('giờ ca và giờ vào ca của thẻ Chấm công hôm nay', async () => {
    m.data['/staff/attendance/status'] = { shifts: [shift('sx', '2026-03-11', 'APPROVED')], openSession: null };
    await mount();
    const listed = Array.from(document.querySelectorAll('li')).find((li) => /^Ca 08:00–12:00/.test(li.textContent ?? ''));
    expect(listed).toBeDefined();
    expect(listed!.closest('section')?.querySelector('div.mt-2')?.classList.contains('tabular-nums')).toBe(true);
    document.body.innerHTML = '';
    m.data['/staff/attendance/status'] = { shifts: [], openSession: { id: 'o1', checkinAt: vn('2026-03-11', '08:05'), isLate: true } };
    await mount();
    const open = Array.from(document.querySelectorAll('p')).find((p) => /^Đang trong ca/.test(p.textContent ?? ''));
    expect(open?.textContent).toContain('08:05');
    expect(open!.parentElement!.classList.contains('tabular-nums')).toBe(true);
  });
});

describe('/nhan-vien — lệnh bị từ chối sau khi nhân viên đã đổi tuần', () => {
  it('Chép tuần bị từ chối 400 khi đang xem tuần sau: tải lại đúng tuần của lệnh, không phải tuần đang xem', async () => {
    let fail!: (e: unknown) => void;
    m.write['POST /staff/shifts/copy-week'] = () => new Promise((_, rej) => (fail = rej));
    await mount();
    click(btn('Chép tuần trước'));
    await flush();
    await press('Tuần sau');
    const week0 = weekGets().length;
    const week1 = weekGets(WEEK1_FROM).length;
    expect(week1).toBeGreaterThan(0);
    await act(async () => {
      fail(new ApiError('Tuần này đã có ca.', 400));
    });
    await flush(6);
    expect(alerts()).toContain('Tuần này đã có ca.');
    expect(weekGets()).toHaveLength(week0 + 1);
    expect(weekGets(WEEK1_FROM)).toHaveLength(week1);
  });
});
