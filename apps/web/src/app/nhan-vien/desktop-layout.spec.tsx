// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// W141: từ lg, Ca làm (/nhan-vien) và Lương (/nhan-vien/bang-luong) chia hai cột (cột bên 22rem dính khi cuộn + cột chính) trong khung 1200px.
// jsdom không tính CSS, nên spec khoá hai điều bằng cấu trúc DOM và lớp Tailwind: (1) mọi lớp bố cục mới đều mang tiền tố `lg:` (dưới lg không đổi);
// (2) các khối bọc mới là `contents` dưới lg và giữ nguyên thứ tự DOM cũ, nên điện thoại vẫn là một cột flex phẳng như trước.

const m = vi.hoisted(() => ({
  role: 'STAFF' as string | null,
  held: false,
  data: {} as Record<string, unknown>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: m.role ? { role: m.role } : null }) }));
vi.mock('@/components/evidence-upload', () => ({ EvidenceUpload: () => null }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      if (m.held) await new Promise(() => undefined);
      if (!(path in m.data)) throw new Error(`chưa mock ${path}`);
      return m.data[path];
    },
  },
}));

import StaffPage from './page';
import MyPayrollPage from './bang-luong/page';
import { StaffShell, staffLayout } from '@/components/staff/staff-shell';

const PROFILE = { hourlyRate: 30000, bankBin: '970407', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN VAN A', qrImageUrl: null, active: true };
const PAYROLL = {
  month: { year: 2026, month: 3, totalMinutes: 270, gross: 135000, totalFines: 0, net: 135000, status: 'FINALIZED', paidAt: null, proofImageUrl: null, note: null },
  days: [{ id: 'd1', workDate: '2026-03-02T00:00:00.000Z', workedMinutes: 270, hourlyRate: 30000, gross: 135000, fines: 0, net: 135000 }],
  profile: PROFILE,
};

beforeAll(async () => {
  await import('@/components/mini/empty-state');
});

let mounted: Rendered[] = [];
const mount = async (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  await flush(8);
  return r.container;
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-11T05:00:00Z'));
  m.role = 'STAFF';
  m.held = false;
  m.data = {
    '/staff/attendance/status': { shifts: [], openSession: null },
    '/staff/shift-templates': [],
    '/staff/shifts': [],
    '/staff/payroll': PAYROLL,
    '/staff/attendance/history': [],
  };
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
  vi.useRealTimers();
});

const classes = (el: Element) => el.className.split(/\s+/).filter(Boolean);
/** Lớp không có tiền tố khổ màn (dưới lg áp dụng): phần giao diện điện thoại và máy tính bảng. */
const baseClasses = (el: Element) => classes(el).filter((c) => !/^(sm|md|lg|xl|2xl|max-[a-z0-9]+):/.test(c));
const lgClasses = (el: Element) => classes(el).filter((c) => c.startsWith('lg:'));
const rootOf = (c: HTMLElement) => c.querySelector('main > div:last-child > div') as HTMLElement;
const aside = (c: HTMLElement) => rootOf(c).children[1] as HTMLElement;
const mainCol = (c: HTMLElement) => rootOf(c).children[2] as HTMLElement;

describe('khung rộng của cổng Nhân viên', () => {
  it('Ca làm và Lương: giữ max-w-5xl px-4 dưới lg, từ lg nới lên khung 1200px và lề px-6', async () => {
    for (const ui of [<StaffPage key="a" />, <MyPayrollPage key="b" />]) {
      const c = await mount(ui);
      const main = c.querySelector('main')!;
      expect(baseClasses(main)).toEqual(['mx-auto', 'max-w-5xl', 'px-4', 'py-6']);
      expect(lgClasses(main)).toEqual(['lg:max-w-frame', 'lg:px-6']);
    }
  });

  it('nhánh bị từ chối quyền cũng dùng khung rộng (không đổi bề rộng khi quyền được xác nhận)', async () => {
    m.role = 'CUSTOMER';
    const c = await mount(<StaffPage />);
    expect(lgClasses(c.querySelector('main')!)).toEqual(['lg:max-w-frame', 'lg:px-6']);
  });

  it('StaffShell không đặt `wide` (màn Chủ thương hiệu dùng chung) giữ nguyên 1024px ở mọi khổ', async () => {
    const c = await mount(<StaffShell title="Quản lý thương hiệu">x</StaffShell>);
    expect(classes(c.querySelector('main')!)).toEqual(['mx-auto', 'max-w-5xl', 'px-4', 'py-6']);
  });
});

describe('/nhan-vien — hai cột từ lg', () => {
  it('khung ngoài là flex một cột dưới lg, lưới 22rem + phần còn lại từ lg; lớp mới đều có tiền tố lg:', async () => {
    const root = rootOf(await mount(<StaffPage />));
    expect(baseClasses(root)).toEqual(['flex', 'flex-col', 'gap-3', 'pb-6']);
    expect(lgClasses(root)).toEqual(['lg:grid', 'lg:grid-cols-[22rem_minmax(0,1fr)]', 'lg:items-start', 'lg:gap-x-6', 'lg:gap-y-3']);
  });

  it('con trực tiếp theo thứ tự: thông báo, cột bên, cột chính; hai khối bọc là `contents` dưới lg', async () => {
    const c = await mount(<StaffPage />);
    const root = rootOf(c);
    expect(root.children).toHaveLength(3);
    const [notice, side, main] = Array.from(root.children) as HTMLElement[];
    expect(notice!.getAttribute('aria-live')).toBe('polite');
    expect(baseClasses(side!)).toEqual(['contents']);
    expect(baseClasses(main!)).toEqual(['contents']);
    expect(lgClasses(side!)).toContain('lg:sticky');
    expect(lgClasses(side!)).toContain('lg:top-[calc(var(--header-h)+1rem)]');
    expect(lgClasses(main!)).toContain('lg:min-w-0');
  });

  it('thông báo rỗng thì không có node con (`lg:empty:hidden` mới ẩn được), trải hai cột', async () => {
    const notice = rootOf(await mount(<StaffPage />)).children[0] as HTMLElement;
    expect(notice.childNodes).toHaveLength(0);
    expect(lgClasses(notice)).toEqual(['lg:col-span-2', 'lg:empty:hidden']);
    expect(baseClasses(notice)).toEqual([]);
  });

  it('cột bên: thẻ hôm nay → chuyển tuần → Đăng ký ca / Chép tuần (thứ tự DOM cũ); cột chính: lưới 7 ngày hai cột, không còn 3 cột', async () => {
    const c = await mount(<StaffPage />);
    const side = aside(c);
    expect(Array.from(side.children).map((e) => e.getAttribute('aria-label') ?? e.tagName.toLowerCase())).toEqual(['Chấm công hôm nay', 'div', 'div']);
    expect(side.children[1]!.textContent).toContain('09/03');
    const actions = Array.from(side.children[2]!.querySelectorAll('button')).map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim());
    expect(actions).toEqual(['Đăng ký ca', 'Chép tuần trước']);

    const days = mainCol(c).querySelector('div.grid')!;
    expect(days.querySelectorAll(':scope > section')).toHaveLength(7);
    expect(classes(days)).toEqual(['grid', 'gap-3', 'md:grid-cols-2']);
  });

  it('đang tải: khung chờ nằm ở cột chính, cột bên vẫn đủ ba khối', async () => {
    m.held = true;
    const c = await mount(<StaffPage />);
    expect(mainCol(c).querySelector('[data-skeleton]')).not.toBeNull();
    expect(aside(c).children).toHaveLength(3);
  });
});

describe('/nhan-vien/bang-luong — hai cột từ lg', () => {
  it('khung ngoài như Ca làm; cột bên theo thứ tự cũ: chuyển tháng → tổng kết → nút nhận lương', async () => {
    const c = await mount(<MyPayrollPage />);
    const root = rootOf(c);
    expect(baseClasses(root)).toEqual(['flex', 'flex-col', 'gap-3', 'pb-6']);
    expect(lgClasses(root)).toContain('lg:grid-cols-[22rem_minmax(0,1fr)]');
    expect(root.children).toHaveLength(3);
    const side = aside(c);
    expect(baseClasses(side)).toEqual(['contents']);
    expect(side.children[0]!.textContent).toContain('Tháng 3/2026');
    expect(side.children[1]!.getAttribute('aria-label')).toBe('Tổng kết tháng');
    expect(side.children[2]!.textContent).toContain('Thông tin nhận lương');
    expect(side.children).toHaveLength(3);
  });

  it('cột chính chứa các tuần và là hộp flex thật dưới lg (khe 12px như bọc grid cũ), không `contents`', async () => {
    const c = await mount(<MyPayrollPage />);
    const main = mainCol(c);
    expect(baseClasses(main)).toEqual(['flex', 'flex-col', 'gap-3']);
    expect(lgClasses(main)).toEqual(['lg:min-w-0']);
    expect(main.textContent).toContain('Tuần 1');
    expect(main.querySelector('[aria-label="Tổng kết tháng"]')).toBeNull();
  });

  it('đang tải: khung chờ ở cột bên ngay sau chuyển tháng, trước nút nhận lương (thứ tự cũ)', async () => {
    m.held = true;
    const side = aside(await mount(<MyPayrollPage />));
    expect(side.children[0]!.textContent).toContain('Tháng 3/2026');
    expect(side.children[1]!.hasAttribute('data-skeleton')).toBe(true);
    expect(side.children[2]!.textContent).toContain('Thông tin nhận lương');
  });
});

describe('staffLayout', () => {
  it('mọi lớp của khối bọc cột bên/cột chính chỉ có `contents` (hoặc hộp flex của mainBox) ở khổ nhỏ', () => {
    const base = (s: string) => s.split(' ').filter((c) => !c.startsWith('lg:'));
    expect(base(staffLayout.aside)).toEqual(['contents']);
    expect(base(staffLayout.main)).toEqual(['contents']);
    expect(base(staffLayout.mainBox)).toEqual(['flex', 'flex-col', 'gap-3']);
    expect(base(staffLayout.notice)).toEqual([]);
  });
});
