// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unlabeledFields, unnamedControls } from '@/test-utils/a11y';

// Mini App staff.spec.tsx: chỉ STAFF/ADMIN, thẻ chấm công (web chỉ hiện trạng thái), lịch tuần, thêm/sửa ca, đăng ký nhanh,
// copy tuần, xoá, huỷ ca (phạt 1h, đột xuất có chứng cứ). Chấm công và heartbeat cần token vị trí Zalo nên web không gọi.

type Call = { method: string; path: string; body?: unknown; query?: Record<string, unknown> };

const m = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  role: 'STAFF' as string | null,
  calls: [] as Call[],
  data: {} as Record<string, unknown>,
  fail: new Set<string>(),
  hold: new Set<string>(),
  post: {} as Record<string, () => unknown>,
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => m.phase }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ retrySession: vi.fn(), user: m.role ? { role: m.role } : null }),
}));
vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) => (
    <button type="button" className="min-h-11" onClick={() => onChange(['data:image/jpeg;base64,AAAA'])}>
      {value.length ? `Đã chọn ${label}` : label}
    </button>
  ),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string, opts?: { query?: Record<string, unknown> }) => {
      m.calls.push({ method: 'get', path, query: opts?.query });
      if (m.fail.has(path)) {
        m.fail.delete(path);
        throw new Error('Mất kết nối');
      }
      if (m.hold.has(path)) await new Promise(() => undefined);
      if (!(path in m.data)) throw new Error(`chưa mock ${path}`);
      return m.data[path];
    },
    post: async (path: string, body?: unknown) => {
      m.calls.push({ method: 'post', path, body });
      const h = m.post[path];
      if (!h) throw new Error(`chưa mock POST ${path}`);
      return h();
    },
    patch: async (path: string, body?: unknown) => {
      m.calls.push({ method: 'patch', path, body });
      return {};
    },
    delete: async (path: string) => {
      m.calls.push({ method: 'delete', path });
      return { deleted: true };
    },
  },
}));

import StaffPage from './page';

// 11/03/2026 12:00 giờ VN (Thứ 4): tuần 09/03–15/03, "hôm nay" = 11/03.
const NOW = '2026-03-11T05:00:00Z';
const TODAY = '2026-03-11';
const vn = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+07:00`).toISOString();

const TEMPLATES = [
  { id: 't1', name: 'Ca sáng', startMin: 480, endMin: 720, active: true, sortOrder: 1 },
  { id: 't2', name: 'Ca chiều', startMin: 780, endMin: 1020, active: true, sortOrder: 2 },
];

const shift = (id: string, day: string, status: string, over: Record<string, unknown> = {}) => ({
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
  ...over,
});

const WEEK_SHIFTS = [
  shift('sr', '2026-03-10', 'REJECTED', { rejectReason: 'Đủ người' }),
  shift('sp', '2026-03-12', 'PENDING'),
  shift('sa', '2026-03-13', 'APPROVED', { approvedStart: vn('2026-03-13', '09:00'), approvedEnd: vn('2026-03-13', '13:00') }),
  shift('sc', '2026-03-14', 'CANCELLED', { cancelPenalty: true }),
];

const OPEN_SESSION = {
  id: 'o1',
  shiftId: 'sh1',
  staffId: 'u1',
  checkinAt: '2026-03-11T01:30:00.000Z',
  checkoutAt: null,
  isLate: true,
  lastHeartbeatAt: '2026-03-11T04:00:00.000Z',
};
const TODAY_SHIFT = shift('sh1', TODAY, 'APPROVED');

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<StaffPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
const nameOf = (b: Element) => (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim();
const btn = (name: string | RegExp) => buttons().find((b) => (typeof name === 'string' ? nameOf(b) === name : name.test(nameOf(b))))!;
const allBtn = (name: RegExp) => buttons().filter((b) => name.test(nameOf(b)));
const h1s = () => Array.from(document.querySelectorAll('h1')).map((h) => h.textContent);
const timeInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="time"]'));
const labelled = (text: string) => {
  const label = Array.from(document.querySelectorAll('label')).find((l) => l.textContent === text);
  return document.getElementById(label?.getAttribute('for') ?? '__none__') as HTMLInputElement | HTMLTextAreaElement | null;
};
const calls = (method: string, path: string) => m.calls.filter((c) => c.method === method && c.path === path);
const sheetTitle = (t: string) => Array.from(document.querySelectorAll('h2')).some((h) => h.textContent === t);
const text = () => document.body.textContent ?? '';
const press = async (name: string | RegExp) => {
  click(btn(name));
  await flush(6);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  m.phase = 'authenticated';
  m.role = 'STAFF';
  m.calls = [];
  m.fail.clear();
  m.hold.clear();
  m.data = {
    '/staff/attendance/status': { shifts: [], openSession: null },
    '/staff/shift-templates': TEMPLATES,
    '/staff/shifts': WEEK_SHIFTS,
  };
  m.post = {
    '/staff/shifts': () => ({ created: 1 }),
    '/staff/shifts/copy-week': () => ({ created: 2, skipped: 0 }),
    '/staff/shifts/sa/cancel': () => ({ cancelled: true, penalty: false }),
  };
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('khung trang /nhan-vien', () => {
  it('đúng một h1 "Ca làm của tôi" khi đang tải và khi có dữ liệu', async () => {
    m.hold.add('/staff/shifts');
    await mount();
    expect(h1s()).toEqual(['Ca làm của tôi']);
    expect(document.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
    mounted.pop()!.unmount();

    m.hold.clear();
    await mount();
    expect(text()).toContain('T2 · 09/03');
    expect(h1s()).toEqual(['Ca làm của tôi']);
  });

  it('không phải nhân viên: báo không có quyền, vẫn đúng một h1, không gọi API', async () => {
    m.role = 'CUSTOMER';
    await mount();
    expect(text()).toContain('Trang dành cho nhân viên. Liên hệ quản trị để được cấp quyền.');
    expect(h1s()).toEqual(['Ca làm của tôi']);
    expect(m.calls).toEqual([]);
  });

  it('ADMIN cũng vào được trang nhân viên', async () => {
    m.role = 'ADMIN';
    await mount();
    expect(text()).toContain('T2 · 09/03');
  });

  it('khách chưa đăng nhập: mời đăng nhập, không gọi API', async () => {
    m.phase = 'guest';
    m.role = null;
    await mount();
    expect(text()).toContain('Đăng nhập để xem ca làm của bạn.');
    expect(h1s()).toEqual(['Ca làm của tôi']);
    expect(m.calls).toEqual([]);
  });

  it('lỗi tải ca: có nút Thử lại gọi lại API', async () => {
    m.fail.add('/staff/shifts');
    await mount();
    expect(text()).toContain('Mất kết nối');
    await press('Thử lại');
    expect(calls('get', '/staff/shifts')).toHaveLength(2);
    expect(text()).toContain('T2 · 09/03');
  });
});

describe('thẻ chấm công hôm nay (chỉ xem)', () => {
  it('hôm nay không có ca đã duyệt thì báo, không có nút Checkin/Checkout', async () => {
    await mount();
    expect(text()).toContain('Hôm nay bạn không có ca đã duyệt.');
    expect(btn('Checkin')).toBeUndefined();
    expect(btn('Checkout')).toBeUndefined();
  });

  it('có ca đã duyệt hôm nay: hiện giờ ca và thay nút Checkin bằng chỉ dẫn mở trên Zalo, không gọi API chấm công', async () => {
    m.data['/staff/attendance/status'] = {
      shifts: [{ ...TODAY_SHIFT, approvedStart: vn(TODAY, '08:00'), approvedEnd: vn(TODAY, '12:00') }],
      openSession: null,
    };
    await mount();
    expect(text()).toContain('Ca 08:00–12:00');
    expect(btn('Checkin')).toBeUndefined();
    expect(text()).toContain('Tính năng này cần mở Tubu Tree trên Zalo.');
    expect(m.calls.filter((c) => c.path.includes('/attendance/') && c.method !== 'get')).toEqual([]);
  });

  it('đang trong ca: hiện giờ vào và "đi trễ", không có Checkout / Quên checkout, không gửi heartbeat', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    m.data['/staff/attendance/status'] = { shifts: [], openSession: OPEN_SESSION };
    await mount();
    expect(text()).toContain('Đang trong ca · vào lúc 08:30 · đi trễ');
    expect(btn('Checkout')).toBeUndefined();
    expect(btn(/Quên checkout/)).toBeUndefined();
    expect(text()).toContain('Tính năng này cần mở Tubu Tree trên Zalo.');
    expect(spy.mock.calls.some((c) => c[1] === 3 * 60 * 1000)).toBe(false);
    expect(m.calls.filter((c) => c.method !== 'get')).toEqual([]);
    spy.mockRestore();
  });

  it('không tải được trạng thái chấm công: báo trong thẻ và Thử lại gọi lại, phần lịch tuần vẫn dùng được', async () => {
    m.fail.add('/staff/attendance/status');
    await mount();
    expect(text()).toContain('Không tải được trạng thái chấm công');
    expect(text()).toContain('T2 · 09/03');
    await press('Tải lại trạng thái');
    expect(calls('get', '/staff/attendance/status')).toHaveLength(2);
    expect(text()).toContain('Hôm nay bạn không có ca đã duyệt.');
  });
});

describe('lịch tuần', () => {
  it('hiện khoảng tuần, 7 ngày; chỉ ngày từ hôm nay có nút Thêm, ngày trống báo chưa đăng ký', async () => {
    await mount();
    expect(text()).toContain('09/03 – 15/03');
    const first = calls('get', '/staff/shifts')[0]!;
    expect(first.query).toEqual({ from: '2026-03-09T00:00:00.000Z', to: '2026-03-15T23:59:59.999Z' });
    for (const label of ['T2 · 09/03', 'T3 · 10/03', 'T4 · 11/03', 'T5 · 12/03', 'T6 · 13/03', 'T7 · 14/03', 'CN · 15/03']) {
      expect(text()).toContain(label);
    }
    expect(allBtn(/^Thêm ca /)).toHaveLength(5);
    expect(text().split('Chưa đăng ký ca.').length - 1).toBe(3);
  });

  it('mỗi ngày là h2; hai nút chuyển tuần có tên và đổi đúng tuần truy vấn', async () => {
    const c = await mount();
    expect(byText(c, 'h2', 'T4 · 11/03')).not.toBeNull();
    await press('Tuần trước');
    expect(text()).toContain('02/03 – 08/03');
    expect(calls('get', '/staff/shifts').some((x) => x.query?.from === '2026-03-02T00:00:00.000Z' && x.query?.to === '2026-03-08T23:59:59.999Z')).toBe(true);
    await press('Tuần sau');
    await press('Tuần sau');
    expect(text()).toContain('16/03 – 22/03');
  });

  it('mỗi ca hiện giờ, trạng thái, giờ đã chỉnh, lý do từ chối, phạt huỷ', async () => {
    await mount();
    for (const t of ['Chờ duyệt', 'Đã duyệt', 'Từ chối', 'Đã huỷ · phạt 1h', 'Lý do: Đủ người', '09:00 – 13:00', '(đã chỉnh)']) {
      expect(text()).toContain(t);
    }
    expect(text().split('08:00 – 12:00').length - 1).toBe(3);
  });

  it('chỉ ca chờ duyệt có Sửa/Xoá; chỉ ca đã duyệt có Huỷ ca', async () => {
    await mount();
    expect(allBtn(/^Sửa ca /)).toHaveLength(1);
    expect(allBtn(/^Xoá ca /)).toHaveLength(1);
    expect(allBtn(/^Huỷ ca /)).toHaveLength(1);
  });

  it('Xoá ca chờ duyệt gọi DELETE đúng ca, báo và tải lại', async () => {
    await mount();
    await press(/^Xoá ca /);
    expect(calls('delete', '/staff/shifts/sp')).toHaveLength(1);
    expect(text()).toContain('Đã xoá ca.');
    expect(calls('get', '/staff/shifts')).toHaveLength(2);
  });

  it('Chép tuần trước: gửi mốc hai tuần; báo số ca đã copy hoặc không có ca', async () => {
    await mount();
    await press('Chép tuần trước');
    expect(calls('post', '/staff/shifts/copy-week')[0]!.body).toEqual({
      sourceWeekStart: '2026-03-02T00:00:00.000Z',
      targetWeekStart: '2026-03-09T00:00:00.000Z',
    });
    expect(text()).toContain('Đã copy 2 ca từ tuần trước.');
    m.post['/staff/shifts/copy-week'] = () => ({ created: 0, skipped: 3 });
    await press('Chép tuần trước');
    expect(text()).toContain('Tuần trước không có ca để copy.');
  });

  it('copy lỗi: báo lỗi máy chủ trong vùng thông báo', async () => {
    m.post['/staff/shifts/copy-week'] = () => {
      throw new Error('Tuần này đã có ca');
    };
    await mount();
    await press('Chép tuần trước');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Tuần này đã có ca');
  });
});

describe('thêm / sửa ca', () => {
  it('theo ca chuẩn: phải chọn ca chuẩn mới gửi được, gửi đúng ngày, giờ và templateId', async () => {
    await mount();
    await press('Thêm ca T4 11/03');
    expect(sheetTitle('Thêm ca · T4 11/03')).toBe(true);
    expect(text()).toContain('Chọn ca chuẩn');
    expect(btn('Gửi duyệt').disabled).toBe(true);
    click(btn('Ca sáng (08:00–12:00)'));
    await press('Gửi duyệt');
    expect(calls('post', '/staff/shifts')[0]!.body).toEqual({
      items: [{ workDate: TODAY, startAt: vn(TODAY, '08:00'), endAt: vn(TODAY, '12:00'), templateId: 't1' }],
    });
    expect(text()).toContain('Đã gửi ca chờ duyệt.');
    expect(text()).not.toContain('Chọn ca chuẩn');
  });

  it('"Giờ khác": hiện hai ô giờ 08:00–12:00, gửi không kèm templateId', async () => {
    await mount();
    await press('Thêm ca T4 11/03');
    expect(timeInputs()).toHaveLength(0);
    click(btn('Giờ khác'));
    expect(timeInputs().map((i) => i.value)).toEqual(['08:00', '12:00']);
    typeInto(timeInputs()[0]!, '09:00');
    await press('Gửi duyệt');
    expect(calls('post', '/staff/shifts')[0]!.body).toEqual({
      items: [{ workDate: TODAY, startAt: vn(TODAY, '09:00'), endAt: vn(TODAY, '12:00') }],
    });
  });

  it('chưa có ca chuẩn nào: hiện ngay hai ô giờ, không có dòng "Chọn ca chuẩn"', async () => {
    m.data['/staff/shift-templates'] = [];
    await mount();
    await press('Thêm ca T4 11/03');
    expect(timeInputs()).toHaveLength(2);
    expect(text()).not.toContain('Chọn ca chuẩn');
  });

  it('chưa có ca chuẩn nào và xoá ô kết thúc: Gửi duyệt bị khoá', async () => {
    m.data['/staff/shift-templates'] = [];
    await mount();
    await press('Thêm ca T4 11/03');
    expect(btn('Gửi duyệt').disabled).toBe(false);
    typeInto(timeInputs()[1]!, '');
    expect(btn('Gửi duyệt').disabled).toBe(true);
  });

  it('chip ca chuẩn báo aria-pressed; ô giờ có nhãn "Bắt đầu"/"Kết thúc"', async () => {
    await mount();
    await press('Thêm ca T4 11/03');
    const sang = btn('Ca sáng (08:00–12:00)');
    expect(sang.getAttribute('aria-pressed')).toBe('false');
    click(sang);
    expect(sang.getAttribute('aria-pressed')).toBe('true');
    click(btn('Giờ khác'));
    expect(sang.getAttribute('aria-pressed')).toBe('false');
    expect(labelled('Bắt đầu')?.value).toBe('08:00');
    expect(labelled('Kết thúc')?.value).toBe('12:00');
    expect(document.querySelector('[role="group"][aria-label="Ca chuẩn"]')).not.toBeNull();
  });

  it('sửa ca chờ duyệt: nạp sẵn giờ cũ, lưu gọi PATCH với giờ mới', async () => {
    await mount();
    await press(/^Sửa ca /);
    expect(sheetTitle('Sửa ca · T5 12/03')).toBe(true);
    expect(timeInputs().map((i) => i.value)).toEqual(['08:00', '12:00']);
    typeInto(timeInputs()[1]!, '11:30');
    await press('Lưu');
    expect(calls('patch', '/staff/shifts/sp')[0]!.body).toEqual({ startAt: vn('2026-03-12', '08:00'), endAt: vn('2026-03-12', '11:30') });
    expect(text()).toContain('Đã cập nhật ca.');
  });

  it('gửi lỗi: báo lỗi máy chủ và giữ khung', async () => {
    m.post['/staff/shifts'] = () => {
      throw new Error('Trùng ca');
    };
    await mount();
    await press('Thêm ca T4 11/03');
    click(btn('Ca sáng (08:00–12:00)'));
    await press('Gửi duyệt');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Trùng ca');
    expect(text()).toContain('Chọn ca chuẩn');
  });
});

describe('đăng ký nhanh cả tuần', () => {
  it('hai ô giờ có nhãn "Bắt đầu"/"Kết thúc" mặc định 08:00 và 17:00', async () => {
    await mount();
    await press('Đăng ký ca');
    expect(labelled('Bắt đầu')?.value).toBe('08:00');
    expect(labelled('Kết thúc')?.value).toBe('17:00');
  });

  it('mặc định T2–T6 từ hôm nay; ngày đã qua bị khoá; gửi đúng các ngày với giờ 08:00–17:00', async () => {
    m.post['/staff/shifts'] = () => ({ created: 3 });
    await mount();
    await press('Đăng ký ca');
    expect(sheetTitle('Đăng ký nhanh cả tuần')).toBe(true);
    expect(btn('T2 09/03').disabled).toBe(true);
    expect(btn('T3 10/03').disabled).toBe(true);
    for (const d of ['T4 11/03', 'T5 12/03', 'T6 13/03']) expect(btn(d).getAttribute('aria-pressed')).toBe('true');
    expect(btn('T7 14/03').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[role="group"][aria-label="Ngày áp dụng"]')).not.toBeNull();
    await press('Gửi duyệt (3 ngày)');
    expect(calls('post', '/staff/shifts')[0]!.body).toEqual({
      items: ['2026-03-11', '2026-03-12', '2026-03-13'].map((d) => ({ workDate: d, startAt: vn(d, '08:00'), endAt: vn(d, '17:00') })),
    });
    expect(text()).toContain('Đã đăng ký 3 ca chờ duyệt.');
  });

  it('bỏ chọn một ngày thì số ngày giảm; bỏ hết thì không gửi được', async () => {
    await mount();
    await press('Đăng ký ca');
    click(btn('T6 13/03'));
    expect(btn('Gửi duyệt (2 ngày)').disabled).toBe(false);
    click(btn('T4 11/03'));
    click(btn('T5 12/03'));
    expect(btn('Gửi duyệt').disabled).toBe(true);
  });

  it('chọn ca chuẩn thì ẩn ô giờ và gửi giờ + templateId của ca chuẩn; bấm lại bỏ chọn', async () => {
    await mount();
    await press('Đăng ký ca');
    click(btn('Ca chiều (13:00–17:00)'));
    expect(timeInputs()).toHaveLength(0);
    click(btn('T6 13/03'));
    await press('Gửi duyệt (2 ngày)');
    expect(calls('post', '/staff/shifts')[0]!.body).toEqual({
      items: ['2026-03-11', '2026-03-12'].map((d) => ({ workDate: d, startAt: vn(d, '13:00'), endAt: vn(d, '17:00'), templateId: 't2' })),
    });
  });
});

describe('huỷ ca đã duyệt', () => {
  const openCancel = async () => {
    await press(/^Huỷ ca /);
    expect(sheetTitle('Huỷ ca đã duyệt')).toBe(true);
  };
  const reason = () => labelled('Lý do huỷ') as HTMLTextAreaElement;

  it('phải nhập lý do mới xác nhận được; huỷ không đột xuất không kèm chứng cứ, báo không phạt', async () => {
    await mount();
    await openCancel();
    expect(btn('Xác nhận huỷ').disabled).toBe(true);
    typeInto(reason(), '  Bận việc nhà ');
    await press('Xác nhận huỷ');
    expect(calls('post', '/staff/shifts/sa/cancel')[0]!.body).toEqual({ reason: 'Bận việc nhà', isEmergency: false });
    expect(text()).toContain('Đã huỷ ca (không phạt).');
    expect(sheetTitle('Huỷ ca đã duyệt')).toBe(false);
  });

  it('nói rõ luật phạt: huỷ trước 3 ngày miễn phạt, trễ hơn phạt 1h công', async () => {
    await mount();
    await openCancel();
    expect(text()).toContain('Huỷ trước 3 ngày: miễn phạt. Trễ hơn: phạt 1h công (trừ đột xuất có chứng cứ, tối đa 3 lần/tháng).');
  });

  it('đột xuất: hiện ô ảnh chứng cứ, bắt buộc có ảnh; báo phạt 1h khi máy chủ tính phạt', async () => {
    m.post['/staff/shifts/sa/cancel'] = () => ({ cancelled: true, penalty: true });
    await mount();
    await openCancel();
    expect(btn('Ảnh chứng cứ')).toBeUndefined();
    typeInto(reason(), 'Ốm');
    click(btn('Đột xuất (có chứng cứ)'));
    expect(btn('Xác nhận huỷ').disabled).toBe(true);
    click(btn('Ảnh chứng cứ'));
    await press('Xác nhận huỷ');
    expect(calls('post', '/staff/shifts/sa/cancel')[0]!.body).toEqual({
      reason: 'Ốm',
      isEmergency: true,
      evidenceUrl: 'data:image/jpeg;base64,AAAA',
    });
    expect(text()).toContain('Đã huỷ ca — bị tính phạt 1h công.');
  });

  it('công tắc "Đột xuất" là switch thật có tên và aria-checked', async () => {
    await mount();
    await openCancel();
    const sw = document.querySelector<HTMLElement>('[role="switch"]')!;
    expect(nameOf(sw)).toBe('Đột xuất (có chứng cứ)');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('huỷ lỗi: báo lỗi máy chủ, giữ khung và lý do đã nhập', async () => {
    m.post['/staff/shifts/sa/cancel'] = () => {
      throw new Error('Quá hạn huỷ');
    };
    await mount();
    await openCancel();
    typeInto(reason(), 'Ốm');
    await press('Xác nhận huỷ');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Quá hạn huỷ');
    expect(reason().value).toBe('Ốm');
  });
});

describe('truy cập', () => {
  it('trang và các khung mở ra: heading đúng thứ tự, mọi nút có tên, vùng chạm 44px, ô nhập có nhãn', async () => {
    await mount();
    expect(headingProblems(document.body)).toEqual([]);
    expect(unnamedControls(document.body)).toEqual([]);
    expect(smallTouchTargets(document.body)).toEqual([]);
    for (const open of ['Đăng ký ca', /^Thêm ca T4/, /^Sửa ca /, /^Huỷ ca /]) {
      await press(open);
      expect(unnamedControls(document.body)).toEqual([]);
      expect(smallTouchTargets(document.body)).toEqual([]);
      expect(unlabeledFields(document.body)).toEqual([]);
      click(btn('Đóng'));
    }
  });
});

describe('/nhan-vien — diện mạo Mini App ở điện thoại', () => {
  it('thẻ chấm công luôn có dòng nhắc WiFi như Mini App, kể cả khi hôm nay không có ca', async () => {
    await mount();
    expect(text()).toContain('Cần ở đúng mạng WiFi công ty & trong vùng để chấm công.');
  });

  it('Chép tuần trước là nút secondary xanh nhạt; thẻ ngày không viền; tiêu đề thẻ cỡ title-sm', async () => {
    await mount();
    expect(btn(/Chép tuần trước/).className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
    const day = Array.from(document.querySelectorAll('section')).find((s) => s.querySelector('h2')?.textContent?.startsWith('T2'))!;
    expect(day.className).toContain('max-md:[box-shadow:var(--elevation-1)]');
    expect(day.querySelector('h2')!.className).toContain('max-md:text-[length:var(--type-title-sm-size)]');
  });
});
