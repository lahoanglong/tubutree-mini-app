// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unlabeledFields, unnamedControls } from '@/test-utils/a11y';
import { formatVnd } from '@/lib/format-vnd';

// Mini App my-payroll.spec.tsx: chỉ STAFF/ADMIN, thực nhận + giờ công + đơn giá + lương gộp + phạt + trạng thái, gom theo
// tuần T2–CN, xổ ngày ra phiên chấm công (biên tháng theo giờ VN), ảnh chứng từ khi đã trả, sheet tài khoản ngân hàng.

type Call = { method: string; path: string; body?: unknown; query?: Record<string, unknown> };

const m = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  role: 'STAFF' as string | null,
  calls: [] as Call[],
  payroll: null as null | ((q: Record<string, unknown>) => unknown),
  history: [] as unknown[],
  failOnce: new Set<string>(),
  hold: new Set<string>(),
  put: null as null | (() => unknown),
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => m.phase }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ retrySession: vi.fn(), user: m.role ? { role: m.role } : null }),
}));
vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) => (
    <button type="button" className="min-h-11" onClick={() => onChange(['data:image/jpeg;base64,QR'])}>
      {value.length ? `Đã chọn ${label}` : label}
    </button>
  ),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string, opts?: { query?: Record<string, unknown> }) => {
      m.calls.push({ method: 'get', path, query: opts?.query });
      if (m.failOnce.has(path)) {
        m.failOnce.delete(path);
        throw new Error('Mất kết nối');
      }
      if (m.hold.has(path)) await new Promise(() => undefined);
      if (path === '/staff/payroll') return m.payroll!(opts?.query ?? {});
      if (path === '/staff/attendance/history') return m.history;
      throw new Error(`chưa mock ${path}`);
    },
    put: async (path: string, body?: unknown) => {
      m.calls.push({ method: 'put', path, body });
      return m.put!();
    },
  },
}));

import MyPayrollPage from './page';

const PROFILE = { hourlyRate: 30000, bankBin: '970407', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN VAN A', qrImageUrl: null, active: true };

const day = (id: string, date: string, workedMinutes: number, fines: number, net: number) => ({
  id,
  workDate: `${date}T00:00:00.000Z`,
  workedMinutes,
  hourlyRate: 30000,
  gross: net + fines,
  fines,
  net,
});

const payroll = (year: number, month: number, over: Record<string, unknown> = {}) => ({
  month: { year, month, totalMinutes: 870, gross: 475000, totalFines: 20000, net: 415000, status: 'FINALIZED', paidAt: null, proofImageUrl: null, note: null, ...over },
  days: [day('d1', '2026-03-02', 270, 0, 135000), day('d2', '2026-03-03', 480, 20000, 220000), day('d3', '2026-03-10', 120, 0, 60000)],
  profile: PROFILE,
});

// Phiên của ngày 02/03: vào 08:00 (trễ), ra 12:30 (giờ VN).
const SESSIONS = [{ id: 's1', shiftId: 'sh1', checkinAt: '2026-03-02T01:00:00.000Z', checkoutAt: '2026-03-02T05:30:00.000Z', isLate: true, closeReason: null }];

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<MyPayrollPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
const nameOf = (b: Element) => (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim();
const btn = (name: string | RegExp) => buttons().find((b) => (typeof name === 'string' ? nameOf(b) === name : name.test(nameOf(b))))!;
const h1s = () => Array.from(document.querySelectorAll('h1')).map((h) => h.textContent);
const text = () => document.body.textContent ?? '';
const press = async (name: string | RegExp) => {
  click(btn(name));
  await flush(6);
};
const labelled = (t: string) => {
  const label = Array.from(document.querySelectorAll('label')).find((l) => l.textContent === t);
  return document.getElementById(label?.getAttribute('for') ?? '__none__') as HTMLInputElement | null;
};
const gets = (path: string) => m.calls.filter((c) => c.method === 'get' && c.path === path);
const sheetOpen = () => Array.from(document.querySelectorAll('h2')).some((h) => h.textContent === 'Thông tin nhận lương');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-15T05:00:00Z'));
  m.phase = 'authenticated';
  m.role = 'STAFF';
  m.calls = [];
  m.failOnce.clear();
  m.hold.clear();
  m.history = SESSIONS;
  m.payroll = (q) => payroll(Number(q.year), Number(q.month));
  m.put = () => PROFILE;
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('khung trang /nhan-vien/bang-luong', () => {
  it('đúng một h1 "Lương của tôi" khi đang tải, có dữ liệu và khi không phải nhân viên', async () => {
    m.hold.add('/staff/payroll');
    await mount();
    expect(h1s()).toEqual(['Lương của tôi']);
    expect(document.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
    mounted.pop()!.unmount();

    m.hold.clear();
    await mount();
    expect(text()).toContain('Thực nhận tháng 3/2026');
    expect(h1s()).toEqual(['Lương của tôi']);
    mounted.pop()!.unmount();

    m.role = 'CUSTOMER';
    m.calls = [];
    await mount();
    expect(text()).toContain('Trang dành cho nhân viên.');
    expect(h1s()).toEqual(['Lương của tôi']);
    expect(m.calls).toEqual([]);
  });

  it('khách chưa đăng nhập: mời đăng nhập, không gọi API', async () => {
    m.phase = 'guest';
    m.role = null;
    await mount();
    expect(text()).toContain('Đăng nhập để xem lương của bạn.');
    expect(m.calls).toEqual([]);
  });

  it('lỗi tải: có Thử lại gọi lại API', async () => {
    m.failOnce.add('/staff/payroll');
    await mount();
    expect(text()).toContain('Mất kết nối');
    await press('Thử lại');
    expect(gets('/staff/payroll')).toHaveLength(2);
    expect(text()).toContain('Thực nhận tháng 3/2026');
  });

  it('chưa có công thì báo trống', async () => {
    m.payroll = (q) => ({ ...payroll(Number(q.year), Number(q.month)), days: [] });
    await mount();
    expect(text()).toContain('Chưa có dữ liệu công tháng này.');
  });
});

describe('bảng lương tháng', () => {
  it('hiện thực nhận, giờ công, đơn giá, lương gộp, phạt, trạng thái đúng như số máy chủ trả về; biên lịch sử theo giờ VN', async () => {
    await mount();
    for (const t of [
      'Thực nhận tháng 3/2026',
      formatVnd(415000),
      'Giờ công: 14h30',
      `Đơn giá: ${formatVnd(30000)}/h`,
      `Lương gộp: ${formatVnd(475000)}`,
      `Phạt: ${formatVnd(20000)}`,
      'Đã chốt',
    ]) {
      expect(text()).toContain(t);
    }
    expect(gets('/staff/payroll')[0]!.query).toEqual({ year: 2026, month: 3 });
    // 01/03 00:00 VN = 28/02 17:00Z; 01/04 00:00 VN = 31/03 17:00Z.
    expect(gets('/staff/attendance/history')[0]!.query).toEqual({ from: '2026-02-28T17:00:00.000Z', to: '2026-03-31T17:00:00.000Z' });
  });

  it('gom theo tuần T2–CN kèm tổng giờ và tiền; ngày có phạt hiện số phạt', async () => {
    await mount();
    for (const t of ['Tuần 1 (02/03–08/03)', `12h30 · ${formatVnd(355000)}`, 'Tuần 2 (09/03–15/03)', `2h00 · ${formatVnd(60000)}`, 'T2 02 · 4h30', `−${formatVnd(20000)} phạt`]) {
      expect(text()).toContain(t);
    }
  });

  it('bấm vào ngày xổ các phiên chấm công; ngày không có phiên báo không có phiên; mở ngày khác thì ngày cũ gập', async () => {
    await mount();
    await press(/T2 02 · 4h30/);
    expect(text()).toContain('08:00 → 12:30 · trễ');
    await press(/T3 03 · 8h00/);
    expect(text()).toContain('Không có phiên chấm công.');
    expect(text()).not.toContain('08:00 → 12:30 · trễ');
  });

  it('hàng ngày là nút báo mở/gập bằng aria-expanded', async () => {
    await mount();
    const row = btn(/T2 02 · 4h30/);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(text()).not.toContain('08:00 → 12:30 · trễ');
  });

  it('nút chuyển tháng có tên và đổi đúng tháng truy vấn', async () => {
    await mount();
    await press('Tháng trước');
    expect(text()).toContain('Tháng 2/2026');
    expect(gets('/staff/payroll').some((c) => c.query?.month === 2 && c.query?.year === 2026)).toBe(true);
    await press('Tháng sau');
    await press('Tháng sau');
    expect(text()).toContain('Tháng 4/2026');
    expect(gets('/staff/payroll').some((c) => c.query?.month === 4)).toBe(true);
  });

  it('đã trả kèm ảnh chứng từ thì hiện ảnh; chưa trả thì không', async () => {
    m.payroll = (q) => payroll(Number(q.year), Number(q.month), { status: 'PAID', proofImageUrl: 'https://img.test/proof.jpg' });
    await mount();
    const img = document.querySelector<HTMLImageElement>('img[alt="Xác nhận chuyển khoản"]');
    expect(img?.getAttribute('src')).toBe('https://img.test/proof.jpg');
    expect(text()).toContain('Ảnh xác nhận đã chuyển:');
    expect(text()).toContain('Đã trả');
    mounted.pop()!.unmount();

    m.payroll = (q) => payroll(Number(q.year), Number(q.month), { status: 'FINALIZED', proofImageUrl: 'https://img.test/proof.jpg' });
    await mount();
    expect(document.querySelector('img[alt="Xác nhận chuyển khoản"]')).toBeNull();
  });
});

describe('thông tin nhận lương', () => {
  const open = async () => press('Thông tin nhận lương');

  it('nạp sẵn hồ sơ, lưu PUT /staff/bank với giá trị đã cắt khoảng trắng, báo thành công, đóng khung và tải lại', async () => {
    await mount();
    await open();
    expect(sheetOpen()).toBe(true);
    typeInto(labelled('Mã số ngân hàng (6 chữ số, VD 970407; chưa biết thì tải ảnh QR ở dưới)'), ' 970436 ');
    expect(labelled('Số tài khoản')?.value).toBe('0123456789');
    expect(labelled('Tên chủ tài khoản')?.value).toBe('NGUYEN VAN A');
    const before = gets('/staff/payroll').length;
    await press('Lưu');
    const put = m.calls.find((c) => c.method === 'put')!;
    expect(put.path).toBe('/staff/bank');
    expect(put.body).toEqual({ bankBin: '970436', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN VAN A' });
    expect(text()).toContain('Đã lưu thông tin nhận lương.');
    expect(sheetOpen()).toBe(false);
    expect(gets('/staff/payroll').length).toBeGreaterThan(before);
  });

  it('ảnh QR đi kèm khi lưu', async () => {
    await mount();
    await open();
    click(btn('QR nhận lương'));
    await press('Lưu');
    expect(m.calls.find((c) => c.method === 'put')!.body).toMatchObject({ qrImageUrl: 'data:image/jpeg;base64,QR' });
  });

  it('lưu lỗi: báo lỗi và giữ khung để nhập lại', async () => {
    m.put = () => {
      throw new Error('Máy chủ bận');
    };
    await mount();
    await open();
    await press('Lưu');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ bận');
    expect(sheetOpen()).toBe(true);
    expect(labelled('Mã số ngân hàng (6 chữ số, VD 970407; chưa biết thì tải ảnh QR ở dưới)')?.value).toBe('970407');
  });

  it('đổi tháng đang tải mà mở thông tin nhận lương: vẫn nạp hồ sơ ngân hàng đã có, không để ô rỗng', async () => {
    await mount();
    m.hold.add('/staff/payroll');
    await press('Tháng trước');
    expect(text()).toContain('Tháng 2/2026');
    await open();
    expect(labelled('Mã số ngân hàng (6 chữ số, VD 970407; chưa biết thì tải ảnh QR ở dưới)')?.value).toBe('970407');
    expect(labelled('Số tài khoản')?.value).toBe('0123456789');
    expect(labelled('Tên chủ tài khoản')?.value).toBe('NGUYEN VAN A');
  });
});

describe('truy cập', () => {
  it('heading đúng thứ tự, nút có tên, vùng chạm 44px, ô nhập có nhãn (kể cả khi mở sheet)', async () => {
    const c = await mount();
    expect(byText(c, 'h1', 'Lương của tôi')).not.toBeNull();
    expect(headingProblems(document.body)).toEqual([]);
    expect(unnamedControls(document.body)).toEqual([]);
    expect(smallTouchTargets(document.body)).toEqual([]);
    await press('Thông tin nhận lương');
    expect(unnamedControls(document.body)).toEqual([]);
    expect(smallTouchTargets(document.body)).toEqual([]);
    expect(unlabeledFields(document.body)).toEqual([]);
  });
});

describe('/nhan-vien/bang-luong — diện mạo Mini App ở điện thoại', () => {
  it('thẻ tổng kết nền gradient xanh, số tiền chữ sans đậm; nút nhận lương secondary', async () => {
    await mount();
    const card = document.querySelector('section[aria-label="Tổng kết tháng"]')!;
    expect(card.className).toContain('max-md:[background:linear-gradient(135deg,var(--color-action-primary-bg),var(--color-action-primary-bg-pressed))]');
    expect(Array.from(card.querySelectorAll('div')).find((d) => d.textContent === formatVnd(415000))!.className).toContain('max-md:font-sans');
    expect(btn('Thông tin nhận lương').className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
  });

  it('trạng thái trống dùng EmptyState có hình hộp minh hoạ', async () => {
    m.payroll = (q) => ({ ...payroll(Number(q.year), Number(q.month)), days: [] });
    await mount();
    const empty = Array.from(document.querySelectorAll('span')).find((s) => s.textContent === 'Chưa có dữ liệu công tháng này.')!;
    expect(empty.parentElement!.querySelector('svg')).not.toBeNull();
  });
});
