// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// Khoá chạm đúp của /nhan-vien (Mini ↔ web): thẻ chấm công, thêm/sửa/xoá ca, đăng ký nhanh, chép tuần, huỷ ca. Ca "cùng tick" gọi
// click hai lần trong MỘT act: state chưa kịp vẽ lại giữa hai cú bấm. Web không có Vào ca / Ra ca / heartbeat (cần token vị trí Zalo).

type Call = { method: string; path: string; body?: unknown; query?: Record<string, string> };
type Deferred = { promise: Promise<unknown>; resolve: (v?: unknown) => void; reject: (e: unknown) => void };
type Gate = { path: string; match?: (q: Record<string, string> | undefined) => boolean; promise: Promise<unknown> };

const m = vi.hoisted(() => ({
  calls: [] as Call[],
  data: {} as Record<string, unknown>,
  gates: [] as Gate[],
  failOnce: new Set<string>(),
  write: {} as Record<string, () => unknown>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { role: 'STAFF' } }) }));
vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ label, onChange }: { label: string; onChange: (v: string[]) => void }) => (
    <button type="button" onClick={() => onChange(['data:image/jpeg;base64,AAAA'])}>
      {label}
    </button>
  ),
}));
vi.mock('@/lib/core-http', () => {
  const run = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
    m.calls.push({ method, path, body, query });
    if (method === 'GET') {
      for (const g of m.gates.filter((x) => x.path === path && (!x.match || x.match(query)))) await g.promise;
      if (m.failOnce.has(path)) {
        m.failOnce.delete(path);
        throw new Error('Mất kết nối');
      }
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
const SHIFTS = () => [shift('sp', '2026-03-12', 'PENDING'), shift('sp2', '2026-03-13', 'PENDING'), shift('sa', '2026-03-13', 'APPROVED'), shift('sb', '2026-03-14', 'APPROVED')];

const defer = (): Deferred => {
  let resolve!: (v?: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
/** Mọi lần GET `path` (khớp `match`) kể từ lúc gọi hàm này bị giữ tới khi gọi `release()`. */
const holdGet = (path: string, match?: Gate['match']) => {
  const d = defer();
  const gate: Gate = { path, match, promise: d.promise };
  m.gates.push(gate);
  return {
    release: () => {
      m.gates.splice(m.gates.indexOf(gate), 1);
      d.resolve();
    },
  };
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
const weekGets = (from: string) => calls('GET', '/staff/shifts').filter((c) => c.query?.from === from);
const sameTick = (...els: HTMLElement[]) =>
  act(() => {
    for (const el of els) el.click();
  });
const busy = (el: HTMLElement) => el.getAttribute('aria-busy') === 'true';
const text = () => document.body.textContent ?? '';
const sheetOpen = (title: string) => Array.from(document.querySelectorAll('h2')).some((h) => h.textContent === title);
const closeBtn = () => document.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]');
const escape = () => act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
const alerts = () => Array.from(document.querySelectorAll('[role="alert"]')).map((a) => a.textContent ?? '');
const press = async (name: string | RegExp) => {
  click(btn(name));
  await flush(6);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  m.calls = [];
  m.gates = [];
  m.failOnce.clear();
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

describe('/nhan-vien — "Thử lại" trả refetch() (nút bận tới khi tải xong)', () => {
  // Truy vấn chưa có data thì lúc refetch bắt đầu nó về 'pending' và thẻ lỗi biến mất, nên chỉ thấy aria-busy ở lần vẽ ngay sau cú bấm;
  // đếm số GET không phân biệt được vì refetch lần hai dùng chung promise. Thẻ "Tải lại trạng thái" của thẻ chấm công
  // biến mất ngay trong cùng lần vẽ với cú bấm nên không quan sát được khoá ở đó.
  it('lịch tuần: "Thử lại" của ErrorState aria-busy ngay sau cú bấm và ca hiện ra khi tải xong', async () => {
    m.failOnce.add('/staff/shifts');
    await mount();
    const hold = holdGet('/staff/shifts');
    const retry = btn('Thử lại');
    click(retry);
    expect(busy(retry)).toBe(true);
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(retry.disabled).toBe(false);
    hold.release();
    await flush();
    expect(text()).toContain('T2 · 09/03');
    expect(btn('Thử lại')).toBeUndefined();
  });
});

describe('/nhan-vien — Thêm ca', () => {
  const openAdd = async () => {
    await press('Thêm ca T4 11/03');
    click(btn('Ca sáng (08:00–12:00)'));
  };
  const submit = () => btn(/^(Gửi duyệt|Đang gửi…)$/);

  it('hai cú bấm cùng tick chỉ gửi một lần; nút aria-busy + aria-disabled, KHÔNG disabled; sheet không đóng được khi đang gửi', async () => {
    const post = defer();
    m.write['POST /staff/shifts'] = () => post.promise;
    await mount();
    await openAdd();
    sameTick(submit(), submit());
    await flush();
    expect(calls('POST', '/staff/shifts')).toHaveLength(1);
    expect(busy(submit())).toBe(true);
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(submit().disabled).toBe(false);
    expect(closeBtn()).toBeNull();
    escape();
    expect(sheetOpen('Thêm ca · T4 11/03')).toBe(true);
    post.resolve({ created: 1 });
    await flush();
    expect(sheetOpen('Thêm ca · T4 11/03')).toBe(false);
    expect(text()).toContain('Đã gửi ca chờ duyệt.');
  });

  it('lệnh trước xong POST, danh sách còn làm mới: mọi nút "Thêm" aria-busy + aria-disabled và bấm không mở tấm; Sửa ca khác vẫn mở, tấm không bận và đóng được; làm mới xong thì Thêm gửi lại được', async () => {
    await mount();
    await openAdd();
    const hold = holdGet('/staff/shifts');
    click(submit());
    await flush();
    expect(calls('POST', '/staff/shifts')).toHaveLength(1);
    expect(sheetOpen('Thêm ca · T4 11/03')).toBe(false);
    for (const name of ['Thêm ca T4 11/03', 'Thêm ca T5 12/03']) {
      const add = btn(name);
      expect(busy(add)).toBe(true);
      expect(add.getAttribute('aria-disabled')).toBe('true');
      expect(add.disabled).toBe(false);
      click(add);
      await flush();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }
    await press('Sửa ca T6 13/03');
    expect(sheetOpen('Sửa ca · T6 13/03')).toBe(true);
    expect(busy(btn(/^(Lưu|Đang gửi…)$/))).toBe(false);
    expect(closeBtn()).not.toBeNull();
    click(closeBtn()!);
    await flush();
    expect(sheetOpen('Sửa ca · T6 13/03')).toBe(false);
    hold.release();
    await flush();
    expect(busy(btn('Thêm ca T4 11/03'))).toBe(false);
    await openAdd();
    click(submit());
    await flush();
    expect(calls('POST', '/staff/shifts')).toHaveLength(2);
  });

  it('gửi lỗi: nhả khoá để gửi lại được, báo lỗi role=alert, sheet vẫn mở và đóng lại được', async () => {
    m.write['POST /staff/shifts'] = () => {
      throw new Error('Trùng ca');
    };
    await mount();
    await openAdd();
    click(submit());
    await flush();
    expect(alerts().join('|')).toContain('Trùng ca');
    expect(sheetOpen('Thêm ca · T4 11/03')).toBe(true);
    expect(closeBtn()).not.toBeNull();
    expect(busy(submit())).toBe(false);
    click(submit());
    await flush();
    expect(calls('POST', '/staff/shifts')).toHaveLength(2);
  });
});

describe('/nhan-vien — Sửa và Xoá ca', () => {
  const saveBtn = () => btn(/^(Lưu|Đang gửi…)$/);

  it('Sửa: hai cú bấm cùng tick chỉ gửi một PATCH, sheet không đóng được khi đang gửi', async () => {
    const patch = defer();
    m.write['PATCH /staff/shifts/sp'] = () => patch.promise;
    await mount();
    await press('Sửa ca T5 12/03');
    typeInto(document.querySelectorAll<HTMLInputElement>('input[type="time"]')[1]!, '11:30');
    sameTick(saveBtn(), saveBtn());
    await flush();
    expect(calls('PATCH', '/staff/shifts/sp')).toHaveLength(1);
    expect(busy(saveBtn())).toBe(true);
    expect(closeBtn()).toBeNull();
    patch.resolve({});
    await flush();
    expect(sheetOpen('Sửa ca · T5 12/03')).toBe(false);
  });

  it('Xoá: hai cú bấm cùng tick chỉ gửi một DELETE; nút của ca đó aria-busy, ca khác vẫn xoá song song', async () => {
    const del = defer();
    m.write['DELETE /staff/shifts/sp'] = () => del.promise;
    await mount();
    const first = btn('Xoá ca T5 12/03');
    const second = btn('Xoá ca T6 13/03');
    sameTick(first, first);
    await flush();
    expect(calls('DELETE', '/staff/shifts/sp')).toHaveLength(1);
    expect(busy(first)).toBe(true);
    expect(first.getAttribute('aria-disabled')).toBe('true');
    expect(first.disabled).toBe(false);
    expect(busy(second)).toBe(false);
    click(second);
    await flush();
    expect(calls('DELETE', '/staff/shifts/sp2')).toHaveLength(1);
    del.resolve({ deleted: true });
    await flush();
    expect(busy(first)).toBe(false);
  });

  it('Xoá giữ khoá tới khi danh sách ca mới về: ca vừa xoá còn hiện thì chạm lại không gửi lệnh thứ hai', async () => {
    await mount();
    const hold = holdGet('/staff/shifts');
    const del = btn('Xoá ca T5 12/03');
    click(del);
    await flush();
    expect(calls('DELETE', '/staff/shifts/sp')).toHaveLength(1);
    expect(text()).toContain('Đã xoá ca.');
    expect(busy(del)).toBe(true);
    click(del);
    await flush();
    expect(calls('DELETE', '/staff/shifts/sp')).toHaveLength(1);
    hold.release();
    await flush();
    expect(busy(del)).toBe(false);
  });

  it('Xoá lỗi: nhả khoá để xoá lại được, báo role=alert', async () => {
    m.write['DELETE /staff/shifts/sp'] = () => {
      throw new Error('Ca đã được duyệt');
    };
    await mount();
    await press('Xoá ca T5 12/03');
    expect(alerts().join('|')).toContain('Ca đã được duyệt');
    expect(busy(btn('Xoá ca T5 12/03'))).toBe(false);
    await press('Xoá ca T5 12/03');
    expect(calls('DELETE', '/staff/shifts/sp')).toHaveLength(2);
  });

  it('Xoá ca A đang bay: nút Sửa của A aria-busy + aria-disabled và bấm không mở tấm (không nạp ca sắp bị xoá)', async () => {
    const del = defer();
    m.write['DELETE /staff/shifts/sp'] = () => del.promise;
    await mount();
    click(btn('Xoá ca T5 12/03'));
    await flush();
    const edit = btn('Sửa ca T5 12/03');
    expect(busy(edit)).toBe(true);
    expect(edit.getAttribute('aria-disabled')).toBe('true');
    expect(edit.disabled).toBe(false);
    click(edit);
    await flush();
    expect(sheetOpen('Sửa ca · T5 12/03')).toBe(false);
    del.resolve({ deleted: true });
    await flush();
    expect(busy(btn('Sửa ca T5 12/03'))).toBe(false);
  });

  it('Sửa ca A xong, danh sách còn làm mới: Sửa lại và Xoá của A đều aria-busy, bấm không mở tấm (không nạp giờ cũ) và không gửi DELETE; ca B không bị ảnh hưởng', async () => {
    await mount();
    await press('Sửa ca T5 12/03');
    typeInto(document.querySelectorAll<HTMLInputElement>('input[type="time"]')[1]!, '11:30');
    const hold = holdGet('/staff/shifts');
    click(saveBtn());
    await flush();
    expect(calls('PATCH', '/staff/shifts/sp')).toHaveLength(1);
    expect(sheetOpen('Sửa ca · T5 12/03')).toBe(false);
    for (const name of ['Sửa ca T5 12/03', 'Xoá ca T5 12/03']) {
      expect(busy(btn(name))).toBe(true);
      expect(btn(name).getAttribute('aria-disabled')).toBe('true');
      expect(btn(name).disabled).toBe(false);
    }
    click(btn('Sửa ca T5 12/03'));
    click(btn('Xoá ca T5 12/03'));
    await flush();
    expect(sheetOpen('Sửa ca · T5 12/03')).toBe(false);
    expect(calls('DELETE', '/staff/shifts/sp')).toHaveLength(0);
    expect(busy(btn('Sửa ca T6 13/03'))).toBe(false);
    expect(busy(btn('Xoá ca T6 13/03'))).toBe(false);
    hold.release();
    await flush();
    expect(busy(btn('Sửa ca T5 12/03'))).toBe(false);
    expect(busy(btn('Xoá ca T5 12/03'))).toBe(false);
  });

  it('tấm sửa A đã mở rồi mới có lệnh xoá A bay: Lưu không gửi PATCH (khoá chung theo id ca)', async () => {
    const del = defer();
    m.write['DELETE /staff/shifts/sp'] = () => del.promise;
    await mount();
    await press('Sửa ca T5 12/03');
    click(btn('Xoá ca T5 12/03'));
    await flush();
    click(saveBtn());
    await flush();
    expect(calls('PATCH', '/staff/shifts/sp')).toHaveLength(0);
    del.resolve({ deleted: true });
    await flush();
  });

  it('Sửa lỗi: nhả khoá để lưu lại được, báo role=alert, giữ giờ đã gõ', async () => {
    m.write['PATCH /staff/shifts/sp'] = () => {
      throw new Error('Ca đã được duyệt');
    };
    await mount();
    await press('Sửa ca T5 12/03');
    typeInto(document.querySelectorAll<HTMLInputElement>('input[type="time"]')[1]!, '11:30');
    click(saveBtn());
    await flush();
    expect(alerts().join('|')).toContain('Ca đã được duyệt');
    expect(sheetOpen('Sửa ca · T5 12/03')).toBe(true);
    expect(document.querySelectorAll<HTMLInputElement>('input[type="time"]')[1]!.value).toBe('11:30');
    expect(busy(saveBtn())).toBe(false);
    click(saveBtn());
    await flush();
    expect(calls('PATCH', '/staff/shifts/sp')).toHaveLength(2);
  });

  it('ca đang được lưu sửa thì nút Xoá của ca đó không gửi DELETE', async () => {
    const patch = defer();
    m.write['PATCH /staff/shifts/sp'] = () => patch.promise;
    await mount();
    await press('Sửa ca T5 12/03');
    click(saveBtn());
    await flush();
    click(btn('Xoá ca T5 12/03'));
    await flush();
    expect(calls('DELETE', '/staff/shifts/sp')).toHaveLength(0);
    patch.resolve({});
    await flush();
  });

  it('xoá xong sau khi đã đổi tuần: làm mới đúng tuần của lệnh xoá, không phải tuần đang xem', async () => {
    const del = defer();
    m.write['DELETE /staff/shifts/sp'] = () => del.promise;
    await mount();
    click(btn('Xoá ca T5 12/03'));
    await flush();
    await press('Tuần sau');
    const before = weekGets(WEEK0_FROM).length;
    del.resolve({ deleted: true });
    await flush();
    expect(weekGets(WEEK0_FROM).length).toBe(before + 1);
  });

  it('xoá ca B đang bay không làm sheet sửa ca A hiện bận', async () => {
    const del = defer();
    m.write['DELETE /staff/shifts/sp2'] = () => del.promise;
    await mount();
    click(btn('Xoá ca T6 13/03'));
    await flush();
    await press('Sửa ca T5 12/03');
    expect(busy(saveBtn())).toBe(false);
    expect(closeBtn()).not.toBeNull();
    del.resolve({ deleted: true });
    await flush();
  });
});

describe('/nhan-vien — Đăng ký nhanh', () => {
  const submit = () => btn(/^Gửi duyệt \(\d+ ngày\)$/);

  it('hai cú bấm cùng tick chỉ gửi một lần; nút aria-busy + aria-disabled, sheet không đóng được khi đang gửi', async () => {
    const post = defer();
    m.write['POST /staff/shifts'] = () => post.promise;
    await mount();
    await press('Đăng ký ca');
    sameTick(submit(), submit());
    await flush();
    expect(calls('POST', '/staff/shifts')).toHaveLength(1);
    expect(busy(submit())).toBe(true);
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(submit().disabled).toBe(false);
    expect(closeBtn()).toBeNull();
    post.resolve({ created: 3 });
    await flush();
    expect(sheetOpen('Đăng ký nhanh cả tuần')).toBe(false);
    expect(text()).toContain('Đã đăng ký 3 ca chờ duyệt.');
  });

  it('lệnh trước xong POST, danh sách còn làm mới: "Đăng ký ca" của tuần đó aria-busy + aria-disabled, bấm không mở tấm; sang tuần khác thì mở được, tấm không bận và đóng được', async () => {
    m.write['POST /staff/shifts'] = () => ({ created: 3 });
    await mount();
    await press('Đăng ký ca');
    const hold = holdGet('/staff/shifts');
    click(submit());
    await flush();
    expect(calls('POST', '/staff/shifts')).toHaveLength(1);
    expect(sheetOpen('Đăng ký nhanh cả tuần')).toBe(false);
    const open = btn('Đăng ký ca');
    expect(busy(open)).toBe(true);
    expect(open.getAttribute('aria-disabled')).toBe('true');
    expect(open.disabled).toBe(false);
    click(open);
    await flush();
    expect(sheetOpen('Đăng ký nhanh cả tuần')).toBe(false);
    await press('Tuần sau');
    expect(busy(btn('Đăng ký ca'))).toBe(false);
    await press('Đăng ký ca');
    expect(sheetOpen('Đăng ký nhanh cả tuần')).toBe(true);
    expect(busy(submit())).toBe(false);
    expect(closeBtn()).not.toBeNull();
    click(closeBtn()!);
    await flush();
    expect(sheetOpen('Đăng ký nhanh cả tuần')).toBe(false);
    hold.release();
    await flush();
  });

  it('gửi lỗi: nhả khoá, giữ sheet, gửi lại được', async () => {
    m.write['POST /staff/shifts'] = () => {
      throw new Error('Trùng ca');
    };
    await mount();
    await press('Đăng ký ca');
    click(submit());
    await flush();
    expect(alerts().join('|')).toContain('Trùng ca');
    expect(sheetOpen('Đăng ký nhanh cả tuần')).toBe(true);
    click(submit());
    await flush();
    expect(calls('POST', '/staff/shifts')).toHaveLength(2);
  });
});

describe('/nhan-vien — Chép tuần trước', () => {
  it('hai cú bấm cùng tick chỉ gửi một lần; nút aria-busy + aria-disabled, KHÔNG disabled', async () => {
    const post = defer();
    m.write['POST /staff/shifts/copy-week'] = () => post.promise;
    await mount();
    const copy = btn('Chép tuần trước');
    sameTick(copy, copy);
    await flush();
    expect(calls('POST', '/staff/shifts/copy-week')).toHaveLength(1);
    expect(busy(copy)).toBe(true);
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    expect(copy.disabled).toBe(false);
    post.resolve({ created: 2, skipped: 0 });
    await flush();
    expect(busy(copy)).toBe(false);
  });

  it('cú bấm bị khoá không xoá thông báo của lần trước (xoá cũ nằm ở onMutate)', async () => {
    m.write['POST /staff/shifts/copy-week'] = () => ({ created: 2, skipped: 0 });
    await mount();
    const hold = holdGet('/staff/shifts');
    click(btn('Chép tuần trước'));
    await flush();
    expect(text()).toContain('Đã copy 2 ca từ tuần trước.');
    click(btn('Chép tuần trước'));
    await flush();
    expect(calls('POST', '/staff/shifts/copy-week')).toHaveLength(1);
    expect(text()).toContain('Đã copy 2 ca từ tuần trước.');
    hold.release();
    await flush();
  });

  it('khoá chung mọi tuần: đổi tuần khi lệnh còn bay thì nút vẫn bận và cú bấm bị bỏ; xong thì làm mới đúng tuần của lệnh rồi chép tuần mới được', async () => {
    const post = defer();
    m.write['POST /staff/shifts/copy-week'] = () => post.promise;
    await mount();
    click(btn('Chép tuần trước'));
    await flush();
    await press('Tuần sau');
    expect(weekGets(WEEK1_FROM).length).toBeGreaterThan(0);
    const copy = btn('Chép tuần trước');
    expect(busy(copy)).toBe(true);
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    click(copy);
    await flush();
    expect(calls('POST', '/staff/shifts/copy-week')).toHaveLength(1);
    const before = weekGets(WEEK0_FROM).length;
    m.write['POST /staff/shifts/copy-week'] = () => ({ created: 1, skipped: 0 });
    post.resolve({ created: 2, skipped: 0 });
    await flush();
    expect(weekGets(WEEK0_FROM).length).toBe(before + 1);
    expect(busy(copy)).toBe(false);
    await press('Chép tuần trước');
    expect(calls('POST', '/staff/shifts/copy-week')).toHaveLength(2);
    expect(calls('POST', '/staff/shifts/copy-week')[1]!.body).toEqual({ sourceWeekStart: WEEK0_FROM, targetWeekStart: WEEK1_FROM });
  });

  it('copy lỗi: nhả khoá, báo role=alert, chép lại được', async () => {
    m.write['POST /staff/shifts/copy-week'] = () => {
      throw new Error('Tuần này đã có ca');
    };
    await mount();
    await press('Chép tuần trước');
    expect(alerts().join('|')).toContain('Tuần này đã có ca');
    await press('Chép tuần trước');
    expect(calls('POST', '/staff/shifts/copy-week')).toHaveLength(2);
  });
});

describe('/nhan-vien — Huỷ ca đã duyệt', () => {
  const reasonField = () => document.querySelector<HTMLTextAreaElement>('textarea')!;
  const submit = () => btn(/^(Xác nhận huỷ|Đang huỷ…)$/);
  const openCancel = async (name: string) => {
    await press(name);
    typeInto(reasonField(), 'Bận việc nhà');
  };

  it('hai cú bấm cùng tick chỉ gửi một lần; nút aria-busy + aria-disabled, KHÔNG disabled; sheet không đóng được khi đang gửi', async () => {
    const post = defer();
    m.write['POST /staff/shifts/sa/cancel'] = () => post.promise;
    await mount();
    await openCancel('Huỷ ca T6 13/03');
    sameTick(submit(), submit());
    await flush();
    expect(calls('POST', '/staff/shifts/sa/cancel')).toHaveLength(1);
    expect(busy(submit())).toBe(true);
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(submit().disabled).toBe(false);
    expect(closeBtn()).toBeNull();
    escape();
    expect(sheetOpen('Huỷ ca đã duyệt')).toBe(true);
    post.resolve({ cancelled: true, penalty: false });
    await flush();
    expect(sheetOpen('Huỷ ca đã duyệt')).toBe(false);
    expect(text()).toContain('Đã huỷ ca (không phạt).');
  });

  it('ca A xong POST, danh sách còn làm mới: nút Huỷ ca của A aria-busy + aria-disabled, bấm không mở tấm; huỷ ca B vẫn mở, tấm không bận, đóng được và gửi được', async () => {
    await mount();
    await openCancel('Huỷ ca T6 13/03');
    const hold = holdGet('/staff/shifts');
    click(submit());
    await flush();
    expect(calls('POST', '/staff/shifts/sa/cancel')).toHaveLength(1);
    expect(sheetOpen('Huỷ ca đã duyệt')).toBe(false);
    const cancelA = btn('Huỷ ca T6 13/03');
    expect(busy(cancelA)).toBe(true);
    expect(cancelA.getAttribute('aria-disabled')).toBe('true');
    expect(cancelA.disabled).toBe(false);
    click(cancelA);
    await flush();
    expect(sheetOpen('Huỷ ca đã duyệt')).toBe(false);
    expect(busy(btn('Huỷ ca T7 14/03'))).toBe(false);
    await openCancel('Huỷ ca T7 14/03');
    expect(busy(submit())).toBe(false);
    expect(closeBtn()).not.toBeNull();
    click(closeBtn()!);
    await flush();
    expect(sheetOpen('Huỷ ca đã duyệt')).toBe(false);
    await openCancel('Huỷ ca T7 14/03');
    click(submit());
    await flush();
    expect(calls('POST', '/staff/shifts/sb/cancel')).toHaveLength(1);
    hold.release();
    await flush();
    expect(busy(btn('Huỷ ca T6 13/03'))).toBe(false);
  });

  it('huỷ lỗi: nhả khoá, giữ lý do đã nhập, báo role=alert, gửi lại được', async () => {
    m.write['POST /staff/shifts/sa/cancel'] = () => {
      throw new Error('Quá hạn huỷ');
    };
    await mount();
    await openCancel('Huỷ ca T6 13/03');
    click(submit());
    await flush();
    expect(alerts().join('|')).toContain('Quá hạn huỷ');
    expect(reasonField().value).toBe('Bận việc nhà');
    expect(busy(submit())).toBe(false);
    click(submit());
    await flush();
    expect(calls('POST', '/staff/shifts/sa/cancel')).toHaveLength(2);
  });

  it('lệnh gửi bản chụp lúc bấm: lý do gõ thêm sau đó không đổi nội dung đã gửi', async () => {
    const post = defer();
    m.write['POST /staff/shifts/sa/cancel'] = () => post.promise;
    await mount();
    await openCancel('Huỷ ca T6 13/03');
    click(submit());
    await flush();
    typeInto(reasonField(), 'Đã sửa sau khi gửi');
    post.resolve({ cancelled: true, penalty: false });
    await flush();
    expect(calls('POST', '/staff/shifts/sa/cancel')[0]!.body).toEqual({ reason: 'Bận việc nhà', isEmergency: false });
  });
});
