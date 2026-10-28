// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

type Call = { method: string; path: string; body?: unknown };

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  me: null as Record<string, unknown> | null,
  dash: null as Record<string, unknown> | null,
  links: [] as unknown[],
  commissions: [] as unknown[],
  payouts: [] as unknown[],
  tax: { year: 2026, fullName: null, taxId: null, items: [], totals: { grossAmount: 0, taxWithheld: 0, netAmount: 0 } } as Record<string, unknown>,
  tiers: null as Record<string, unknown> | null,
  milestones: null as Record<string, unknown> | null,
  storefronts: [] as unknown[],
  products: [] as unknown[],
  fail: new Set<string>(),
  calls: [] as Call[],
  share: vi.fn(),
  copied: [] as string[],
  registerGate: null as null | Promise<unknown>,
  dashGate: null as null | Promise<unknown>,
  routeReady: { gianHang: true },
  courses: [{ id: 'c1' }] as unknown[],
  tab: undefined as string | undefined,
}));

vi.mock('@/components/ui/segmented-tabs', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<typeof import('@/components/ui/segmented-tabs')>()),
    useTabParam: (_keys: readonly string[], fallback: string) => React.useState(state.tab ?? fallback),
  };
});
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { id: 'ctv1' } }) }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { share: (...a: unknown[]) => state.share(...a) } }));
vi.mock('@/lib/route-map', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/route-map')>()),
  isWebRouteReady: (p: string) => p === '/hoc-vien' || (p === '/ctv/gian-hang' && state.routeReady.gianHang),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ method: 'get', path });
      if (state.fail.has(path)) throw new Error('mất mạng');
      if (path === '/affiliate/me') return state.me;
      if (path === '/affiliate/dashboard') {
        await state.dashGate;
        return state.dash;
      }
      if (path === '/affiliate/links') return state.links;
      if (path === '/affiliate/commissions') return state.commissions;
      if (path === '/affiliate/payouts') return state.payouts;
      if (path === '/affiliate/tiers') return state.tiers;
      if (path === '/affiliate/milestones') return state.milestones;
      if (path === '/academy/courses') return state.courses;
      if (path === '/affiliate/analytics/storefronts') return { storefronts: state.storefronts };
      if (path === '/affiliate/analytics/products') return state.products;
      if (path === '/config/public') return {};
      if (path === '/me/wallet') return { walletBalance: 50_000 };
      return state.tax;
    },
    post: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'post', path, body });
      if (path === '/affiliate/register') await state.registerGate;
      return { ok: true, referralCode: 'TUBU88', shortCode: 'x' };
    },
  },
}));

import AffiliatePage from './page';

let mounted: Rendered[] = [];
const mount = () => {
  const r = render(<AffiliatePage />);
  mounted.push(r);
  return r;
};
const posts = () => state.calls.filter((c) => c.method === 'post');

const DASH = {
  todayCommission: 5_000,
  monthCommission: 125_000,
  pendingCommission: 30_000,
  withdrawableCommission: 80_000,
  withdrawingCommission: 20_000,
  totalClicks: 4,
  totalConversions: 1,
  monthRevenue: 0,
  tier: { name: 'Hạt Giống', emoji: '🌱', nextName: null, nextThreshold: null, toNext: 0 },
};

beforeEach(() => {
  state.phase = 'authenticated';
  state.me = { isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 };
  state.dash = DASH;
  state.links = [];
  state.commissions = [];
  state.payouts = [];
  state.tiers = null;
  state.milestones = null;
  state.storefronts = [];
  state.products = [];
  state.fail = new Set();
  state.calls = [];
  state.share = vi.fn(async () => 'shared');
  state.registerGate = null;
  state.dashGate = null;
  state.routeReady.gianHang = true;
  state.courses = [{ id: 'c1' }];
  state.tab = undefined;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void state.copied.push(t) } });
  state.copied = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/ctv — cổng vào theo phiên', () => {
  it('khách: nút đăng nhập mang returnTo=/ctv và không gọi API CTV', async () => {
    state.phase = 'guest';
    const { container } = mount();
    await flush();
    expect(container.querySelector('a[href="/dang-nhap?returnTo=%2Fctv"]')).not.toBeNull();
    expect(state.calls).toEqual([]);
  });

  it('đang khôi phục phiên: hiện "Đang tải…", chưa gọi API', async () => {
    state.phase = 'loading';
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Đang tải…');
    expect(state.calls).toEqual([]);
  });

  it('mất kết nối lúc khôi phục: nói đúng chuyện đó, không mời đăng nhập', async () => {
    state.phase = 'unavailable';
    const { container } = mount();
    await flush();
    expect(container.querySelector('a[href^="/dang-nhap"]')).toBeNull();
    expect(container.textContent).toMatch(/kết nối/i);
  });

  it('lỗi tải /affiliate/me: có nút Thử lại gọi lại API', async () => {
    state.fail.add('/affiliate/me');
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('mất mạng');
    state.fail.clear();
    click(byText(container, 'button', 'Thử lại'));
    await flush();
    expect(container.textContent).toContain('Có thể chuyển vào Ví');
  });

  it('đúng một h1 ở trạng thái đăng ký và bảng điều khiển', async () => {
    state.me = { isAffiliate: false, referralCode: '', walletBalance: 0 };
    const a = mount();
    await flush();
    expect(a.container.querySelectorAll('h1')).toHaveLength(1);
    state.me = { isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 };
    const b = mount();
    await flush();
    expect(b.container.querySelectorAll('h1')).toHaveLength(1);
  });
});

describe('/ctv — đăng ký CTV (điều khoản hoa hồng & thuế)', () => {
  beforeEach(() => {
    state.me = { isAffiliate: false, referralCode: '', walletBalance: 0 };
  });

  it('hiện điều khoản, lợi ích hoa hồng vào Ví 1:1 (không nhắc rút ngân hàng), nút bị khoá tới khi tick đồng ý, không gọi API', async () => {
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Điều khoản hoa hồng & thuế');
    expect(container.textContent).toContain('hết thời gian đổi/trả');
    expect(container.textContent).toContain('Hoa hồng vào Ví Tubu 1:1, dùng trả tiền hàng');
    expect(container.textContent).not.toMatch(/Rút về ngân hàng|tối thiểu/);
    const btn = byText(container, 'button', 'Đăng ký miễn phí ngay') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(container.textContent).toContain('Chọn ô đồng ý điều khoản để đăng ký');
    click(btn);
    await flush();
    expect(posts()).toEqual([]);
  });

  it('tick đồng ý rồi đăng ký: POST /affiliate/register {termsVersion} đúng một lần, rồi vào bảng điều khiển', async () => {
    const { container } = mount();
    await flush();
    click(container.querySelector('input[type="checkbox"]'));
    state.me = { isAffiliate: true, referralCode: 'TUBU88', walletBalance: 0 };
    click(byText(container, 'button', 'Đăng ký miễn phí ngay'));
    await flush();
    expect(posts()).toEqual([{ method: 'post', path: '/affiliate/register', body: { termsVersion: '2026-10' } }]);
    expect(container.textContent).toContain('Có thể chuyển vào Ví');
  });

  it('bấm đăng ký hai lần trong lúc đang gửi: chỉ một POST', async () => {
    let release!: () => void;
    state.registerGate = new Promise<void>((r) => (release = r));
    const { container } = mount();
    await flush();
    click(container.querySelector('input[type="checkbox"]'));
    const btn = byText(container, 'button', 'Đăng ký miễn phí ngay');
    click(btn);
    click(btn);
    await flush();
    expect(posts()).toHaveLength(1);
    release();
    await flush();
  });

  it('đại lý/nhân viên không đăng ký được (canRegister=false): không có form, có đường về hồ sơ', async () => {
    state.me = { isAffiliate: false, canRegister: false, referralCode: '', walletBalance: 0 };
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Tài khoản này không đăng ký CTV được');
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.querySelector('a[href="/tai-khoan"]')).not.toBeNull();
  });
});

describe('/ctv — bảng điều khiển', () => {
  it('thẻ hoa hồng tháng, số đang chờ, có thể chuyển vào Ví và dòng lệnh rút cũ đúng số', async () => {
    const { container } = mount();
    await flush();
    const t = container.textContent ?? '';
    expect(t).toContain('125.000đ');
    expect(t).toContain('30.000đ');
    expect(t).toContain('80.000đ');
    expect(t).toContain('Còn 20.000đ nằm trong lệnh rút ngân hàng cũ');
  });

  it('số to là "Có thể chuyển vào Ví"; hoa hồng đang chờ là dòng phụ và số tạm tính tháng nằm riêng', async () => {
    const { container } = mount();
    await flush();
    const hero = container.querySelector('section[aria-label="Hoa hồng có thể chuyển vào Ví"]')!;
    expect(hero.textContent).toContain('Có thể chuyển vào Ví80.000đ');
    expect(hero.textContent).toContain('Đang chờ: 30.000đ');
    expect(hero.textContent).toContain('125.000đTạm tính tháng này');
    expect(hero.textContent).not.toContain('Hôm nay');
  });

  it('dòng "Số dư Ví" dẫn sang Ví Tubu', async () => {
    const { container } = mount();
    await flush();
    const row = container.querySelector('a[href="/tai-khoan/vi-tubu"]')!;
    expect(row.textContent).toContain('Số dư Ví: 50.000đ');
  });

  it('CTV mới chưa có đơn: thẻ "Việc đầu tiên" có ba việc; có đơn rồi thì ẩn', async () => {
    state.dash = { ...DASH, monthCommission: 0, pendingCommission: 0, withdrawableCommission: 0, totalConversions: 0 };
    const a = mount();
    await flush();
    const card = a.container.querySelector('section[aria-label="Việc đầu tiên"]')!;
    expect(card.textContent).toContain('1. Chia sẻ mã giới thiệu');
    expect(card.textContent).toContain('2. Mở gian hàng của bạn');
    expect(card.textContent).toContain('3. Học khoá đầu tiên');
    a.unmount();
    state.dash = DASH;
    const b = mount();
    await flush();
    expect(b.container.querySelector('section[aria-label="Việc đầu tiên"]')).toBeNull();
  });

  it('mở trang chỉ gọi dữ liệu tab Tổng quan; hoa hồng và link chỉ tải khi mở tab của chúng', async () => {
    const { container } = mount();
    await flush();
    const got = () => state.calls.filter((c) => c.method === 'get').map((c) => c.path);
    expect(got()).not.toContain('/affiliate/commissions');
    expect(got()).not.toContain('/affiliate/links');
    click(byText(container, '[role="tab"]', 'Hoa hồng'));
    await flush();
    expect(got()).toContain('/affiliate/commissions');
    expect(got()).not.toContain('/affiliate/links');
    click(byText(container, '[role="tab"]', 'Chia sẻ'));
    await flush();
    expect(got()).toContain('/affiliate/links');
  });

  it('lỗi tải dashboard: không hiện 0đ giả và có Thử lại', async () => {
    state.fail.add('/affiliate/dashboard');
    const { container } = mount();
    await flush();
    expect(container.textContent).not.toContain('Đang chờ:');
    expect(byText(container, 'button', 'Thử lại')).not.toBeNull();
  });

  it('lối tắt: Chia sẻ, Gian hàng (link /ctv/gian-hang), Lên đơn hộ, Chuyển vào Ví theo cờ của /affiliate/me', async () => {
    const { container } = mount();
    await flush();
    const group = container.querySelector('[role="group"]')!;
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Chia sẻ', 'Lên đơn hộ', 'Chuyển vào Ví']);
    expect(group.querySelector('a[href="/ctv/gian-hang"]')?.textContent).toContain('Gian hàng');
  });

  it('đại lý chưa có gian hàng và chưa được lên đơn hộ: chỉ còn Chia sẻ và Chuyển vào Ví', async () => {
    state.me = { isAffiliate: true, canOpenStorefront: false, canOrderForCustomer: false, referralCode: 'TUBU88', walletBalance: 0 };
    const { container } = mount();
    await flush();
    const group = container.querySelector('[role="group"]')!;
    expect(group.querySelector('a')).toBeNull();
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Chia sẻ', 'Chuyển vào Ví']);
  });

  it('trang Gian hàng web chưa làm xong thì không có lối tắt Gian hàng', async () => {
    state.routeReady.gianHang = false;
    const { container } = mount();
    await flush();
    expect(container.querySelector('a[href="/ctv/gian-hang"]')).toBeNull();
  });

  it('Chuyển vào Ví luôn bấm được: chưa có số chuyển được thì hộp nói vì sao và số đang chờ', async () => {
    state.dash = { ...DASH, withdrawableCommission: 0 };
    const { container } = mount();
    await flush();
    const btn = byText(container, '[role="group"] button', 'Chuyển vào Ví') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    click(btn);
    await flush();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Hoa hồng tự vào Ví Tubu khi đơn đã giao và hết thời gian đổi/trả. Đang chờ: 30.000đ.');
    expect(byText(dialog as HTMLElement, 'button', 'vào Ví')).toBeNull();
    click(byText(dialog as HTMLElement, 'button', 'Đã hiểu'));
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('cờ tự chuyển tắt: hộp không hứa tự vào Ví', async () => {
    state.dash = { ...DASH, withdrawableCommission: 0, autoWalletTransfer: false };
    const { container } = mount();
    await flush();
    click(byText(container, '[role="group"] button', 'Chuyển vào Ví'));
    await flush();
    const text = document.querySelector('[role="dialog"]')?.textContent ?? '';
    expect(text).toContain('Hoa hồng chuyển được vào Ví Tubu khi đơn đã giao');
    expect(text).not.toContain('tự vào');
  });

  it('còn hoa hồng có thể chuyển: dưới số to có dòng nói đây là phần chưa tự vào Ví, bấm tay; hết thì không có dòng đó', async () => {
    const a = mount();
    await flush();
    expect(a.container.textContent).toContain('Phần này chưa tự vào Ví được');
    a.unmount();
    state.dash = { ...DASH, withdrawableCommission: 0 };
    const b = mount();
    await flush();
    expect(b.container.textContent).not.toContain('Phần này chưa tự vào Ví');
  });

  it('bấm Chuyển vào Ví khi dashboard còn đang tải: hộp hiện khung chờ, không nói "Đang chờ: 0đ" rồi đổi', async () => {
    let release!: () => void;
    state.dashGate = new Promise<void>((r) => (release = r));
    const { container } = mount();
    await flush();
    click(byText(container, '[role="group"] button', 'Chuyển vào Ví'));
    await flush();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-busy') ?? dialog?.querySelector('[aria-busy="true"]')?.getAttribute('aria-busy')).toBe('true');
    expect(dialog?.textContent).not.toContain('Đang chờ');
    release();
    await flush();
  });

  it('Chuyển vào Ví mở sheet "Chuyển hoa hồng vào Ví" với số chuyển được của dashboard, không có lựa chọn ngân hàng', async () => {
    const { container } = mount();
    await flush();
    click(byText(container, '[role="group"] button', 'Chuyển vào Ví'));
    await flush();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Chuyển hoa hồng vào Ví');
    expect(dialog?.textContent).not.toMatch(/Ngân hàng|ZaloPay|tài khoản/);
    expect(dialog?.textContent).toContain('80.000đ');
  });

  it('chuyển xong: đóng sheet, báo đã chuyển, tải lại dashboard, lịch sử chuyển và bảng kê thuế', async () => {
    state.tab = 'commission';
    const { container } = mount();
    await flush();
    click(byText(container, '[role="group"] button', 'Chuyển vào Ví'));
    await flush();
    const before = (path: string) => state.calls.filter((c) => c.method === 'get' && c.path === path).length;
    const dashBefore = before('/affiliate/dashboard');
    const payoutsBefore = before('/affiliate/payouts');
    click(byText(document.body, '[role="dialog"] button', 'vào Ví'));
    await flush();
    expect(posts().find((c) => c.path === '/affiliate/payouts')?.body).toMatchObject({ amount: 80_000, method: 'WALLET_BALANCE' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('Đã chuyển hoa hồng vào Ví Tubu.');
    expect(before('/affiliate/dashboard')).toBeGreaterThan(dashBefore);
    expect(before('/affiliate/payouts')).toBeGreaterThan(payoutsBefore);
  });

  it('Lên đơn hộ mở sheet "Lên đơn hộ khách", chưa gọi API nào khi chưa điền gì', async () => {
    const { container } = mount();
    await flush();
    const before = state.calls.length;
    click(byText(container, '[role="group"] button', 'Lên đơn hộ'));
    await flush();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Lên đơn hộ khách');
    expect(state.calls.length).toBe(before);
    expect(posts()).toEqual([]);
  });

  it('Chia sẻ mở bảng chia sẻ; nút Chia sẻ trong bảng gọi bridge với đường dẫn có mã; chép link thì báo đã chép; thất bại thì báo gửi mã thủ công', async () => {
    const { container } = mount();
    await flush();
    click(byText(container, '[role="group"] button', 'Chia sẻ'));
    await flush();
    const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog().textContent).toContain('Chia sẻ mã giới thiệu');
    state.share = vi.fn(async () => 'copied');
    click(byText(dialog(), 'button', 'Chia sẻ'));
    await flush();
    expect(state.share).toHaveBeenCalledWith(expect.objectContaining({ path: '/?ref=TUBU88', text: expect.stringContaining('TUBU88') }));
    expect(dialog().textContent).toContain('Đã sao chép');
    state.share = vi.fn(async () => 'failed');
    click(byText(dialog(), 'button', 'Chia sẻ'));
    await flush();
    expect(dialog().textContent).toContain('Chưa chia sẻ được');
  });

  it('tab Chia sẻ: nút trong thẻ mã là "Sao chép mã" và chép đúng mã', async () => {
    state.tab = 'share';
    const { container } = mount();
    await flush();
    click(byText(container, 'button', 'Sao chép mã'));
    await flush();
    expect(state.copied).toEqual(['TUBU88']);
  });

  it('danh sách link: rỗng có lời mời; có link thì sao chép đúng URL kèm ref và l', async () => {
    state.tab = 'share';
    const empty = mount();
    await flush();
    expect(empty.container.textContent).toContain('Chưa có link');
    state.links = [{ id: 'l1', shortCode: 'abc123', targetType: 'HOMEPAGE', targetId: null, clicks: 3, conversions: 1, revenue: 0, createdAt: '2026-10-01T00:00:00Z' }];
    const full = mount();
    await flush();
    expect(full.container.textContent).toContain('Trang chủ');
    expect(full.container.textContent).toContain('3 lượt bấm');
    expect(full.container.textContent).not.toContain('3 lượt bấm ·');
    expect(full.container.textContent).toContain('Lượt bấm');
    click(Array.from(full.container.querySelectorAll('button')).find((b) => b.textContent === 'Sao chép') ?? null);
    await flush();
    expect(state.copied[0]).toMatch(/\/\?ref=TUBU88&l=abc123$/);
  });

  it('+ Tạo link: POST /affiliate/links {targetType: HOMEPAGE} đúng một lần dù bấm hai lần', async () => {
    state.tab = 'share';
    const { container } = mount();
    await flush();
    const btn = byText(container, 'button', '+ Tạo link');
    click(btn);
    click(btn);
    await flush();
    expect(posts()).toEqual([{ method: 'post', path: '/affiliate/links', body: { targetType: 'HOMEPAGE', targetId: undefined } }]);
  });

  it('lịch sử hoa hồng: số, mã đơn, trạng thái đơn và nhãn như Mini App; khoản trong lệnh rút cũ không bị ghi "Đã trả"', async () => {
    state.tab = 'commission';
    state.commissions = [
      { id: 'c1', orderId: 'o1', orderCode: 'TB1', orderTotal: 500_000, rate: '0.1', amount: 50_000, status: 'APPROVED', createdAt: '2026-10-02T03:00:00Z', orderStatus: 'DELIVERED' },
      { id: 'c2', orderId: 'o2', orderTotal: 100_000, rate: '0.1', amount: 10_000, status: 'APPROVED', createdAt: '2026-10-03T03:00:00Z', withdrawing: true },
      { id: 'c3', orderId: 'o3', orderTotal: 100_000, rate: '0.1', amount: 10_000, status: 'LOCKED', createdAt: '2026-10-03T03:00:00Z' },
    ];
    const { container } = mount();
    await flush();
    const t = container.textContent ?? '';
    expect(t).toContain('+50.000đ');
    expect(t).toContain('Đơn TB1 · 500.000đ');
    expect(t).toContain('Giao thành công');
    expect(t).toContain('Có thể chuyển vào Ví');
    expect(t).toContain('Lệnh rút cũ đang xử lý');
    expect(t).toContain('Đang chờ · đang giữ');
  });

  it('lịch sử hoa hồng: rỗng có lời mời, lỗi tải có Thử lại', async () => {
    state.tab = 'commission';
    const a = mount();
    await flush();
    expect(a.container.textContent).toContain('Chưa có hoa hồng');
    state.fail.add('/affiliate/commissions');
    const b = mount();
    await flush();
    expect(b.container.textContent).toContain('mất mạng');
  });

  it('lịch sử chuyển vào Ví: trạng thái, phương thức, thuế đã khấu trừ, lý do từ chối, mã giao dịch; năm có khấu trừ thì có tổng thuế', async () => {
    state.tab = 'commission';
    state.payouts = [
      { id: 'p1', amount: 90_000, grossAmount: 100_000, taxWithheld: 10_000, fee: 0, method: 'BANK', status: 'PAID', rejectionReason: null, bankRef: 'FT123', requestedAt: '2026-10-01T03:00:00Z', reviewedAt: null, paidAt: null },
      { id: 'p2', amount: 50_000, grossAmount: 50_000, taxWithheld: 0, fee: 0, method: 'WALLET_BALANCE', status: 'REJECTED', rejectionReason: 'Sai tài khoản', bankRef: null, requestedAt: '2026-10-02T03:00:00Z', reviewedAt: null, paidAt: null },
    ];
    state.tax = { year: 2026, fullName: null, taxId: null, items: [], totals: { grossAmount: 100_000, taxWithheld: 10_000, netAmount: 90_000 } };
    const { container } = mount();
    await flush();
    const t = container.textContent ?? '';
    expect(t).toContain('Đã chuyển');
    expect(t).toContain('Về ngân hàng');
    expect(t).toContain('đã khấu trừ thuế TNCN 10.000đ');
    expect(t).toContain('Mã giao dịch: FT123');
    expect(t).toContain('Bị từ chối');
    expect(t).toContain('Về Ví Tubu');
    expect(t).toContain('Lý do: Sai tài khoản');
    expect(t).toContain('Năm 2026: thu nhập hoa hồng 100.000đ');
  });

  it('lệnh được hoàn thuế giữ dư (Q2b): hiện số đã hoàn vào Ví như Mini App', async () => {
    state.tab = 'commission';
    state.payouts = [
      { id: 'p1', amount: 750_000, grossAmount: 1_000_000, taxWithheld: 0, taxRefunded: 250_000, fee: 0, method: 'BANK', status: 'PAID', rejectionReason: null, bankRef: null, requestedAt: '2026-10-01T03:00:00Z', reviewedAt: null, paidAt: null },
    ];
    const { container } = mount();
    await flush();
    const t = container.textContent ?? '';
    expect(t).toContain('Hoa hồng 1.000.000đ');
    expect(t).toContain('đã hoàn 250.000đ thuế giữ dư vào Ví');
    expect(t).not.toContain('đã khấu trừ thuế TNCN 0');
  });

  it('lịch sử chuyển rỗng: "Chưa có lần chuyển nào."', async () => {
    state.tab = 'commission';
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Chưa có lần chuyển nào.');
  });

  it('không có khoá học nào thì ẩn lối vào Học viện (B-37)', async () => {
    state.courses = [];
    const { container } = mount();
    await flush();
    expect(container.querySelector('a[href="/hoc-vien"]')).toBeNull();
  });

  it('lối sang /hoc-vien chỉ hiện khi route web đã sẵn sàng', async () => {
    const { container } = mount();
    await flush();
    const academy = container.querySelector('a[href="/hoc-vien"]')!;
    expect(academy).not.toBeNull();
    // Chữ như Mini App (vi.academy.entry / entryHint), nút phụ nền nhạt không viền ở điện thoại.
    expect(academy.textContent).toBe('Học viện CTV');
    expect(academy.nextElementSibling!.textContent).toBe('Khoá học đào tạo dành cho CTV');
    expect(academy.className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
  });
});

const TIERS = {
  revenue: 3_000_000,
  tier: DASH.tier,
  allTiers: [
    { name: 'Hạt Giống', emoji: '🌱', min: 0, milestoneRewardPoints: null },
    { name: 'Nảy Mầm', emoji: '🌿', min: 1_000_000, milestoneRewardPoints: 600 },
  ],
};
const MILESTONES = {
  monthKey: '2026-10',
  currentRevenue: 4_000_000,
  pendingRevenue: 0,
  holdDays: 20,
  milestones: [
    { id: 'A', title: 'Mốc A', threshold: 3_000_000, rewardPoints: 100, description: '', achieved: true, claimed: false, canClaim: true, progressPct: 100 },
  ],
  previousMonth: null,
};

describe('/ctv — bậc, thưởng mốc, phân tích', () => {
  it('bậc CTV hiện từ dashboard; bảng 5 bậc lấy từ /affiliate/tiers', async () => {
    state.dash = { ...DASH, monthRevenue: 3_000_000, tier: { name: 'Nảy Mầm', emoji: '🌿', nextName: 'Đơm Hoa', nextThreshold: 10_000_000, toNext: 7_000_000 } };
    state.tiers = TIERS;
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('CTV Nảy Mầm');
    click(container.querySelector('button[aria-expanded]'));
    expect(container.textContent).toContain('Thưởng mốc +600 điểm');
  });

  it('thưởng mốc: có mốc nhận được thì nút Nhận thưởng gọi POST claim kèm tháng', async () => {
    state.milestones = MILESTONES;
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Thưởng mốc doanh số tháng');
    click(byText(container, 'button', 'Nhận thưởng'));
    await flush();
    expect(posts().find((c) => c.path === '/affiliate/milestones/A/claim')?.body).toEqual({ month: '2026-10' });
  });

  it('thưởng mốc lỗi tải: có Thử lại, không làm hỏng phần còn lại của trang', async () => {
    state.fail.add('/affiliate/milestones');
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('mất mạng');
    expect(container.textContent).toContain('Có thể chuyển vào Ví');
  });

  it('theo gian hàng: dòng có tên, số đơn, doanh số và hoa hồng; rỗng có lời mời; lỗi có Thử lại', async () => {
    state.tab = 'commission';
    const empty = mount();
    await flush();
    expect(empty.container.textContent).toContain('Chưa có đơn từ gian hàng nào');
    state.storefronts = [{ slug: 'vuon-xanh', title: 'Vườn Xanh', orders: 3, revenue: 900_000, commission: 90_000 }];
    const full = mount();
    await flush();
    expect(full.container.textContent).toContain('Vườn Xanh');
    expect(full.container.textContent).toContain('3 đơn · DS 900.000đ');
    expect(full.container.textContent).toContain('+90.000đ');
    state.fail.add('/affiliate/analytics/storefronts');
    const failed = mount();
    await flush();
    expect(byText(failed.container, 'button', 'Thử lại')).not.toBeNull();
  });

  it('theo sản phẩm: tối đa 10 dòng, rỗng có lời mời', async () => {
    state.tab = 'commission';
    const empty = mount();
    await flush();
    expect(empty.container.textContent).toContain('Chưa có hoa hồng theo sản phẩm');
    state.products = Array.from({ length: 12 }, (_, i) => ({ productName: `SP ${i + 1}`, commission: 1_000 * (i + 1), orders: i + 1 }));
    const { container } = mount();
    await flush();
    const section = container.querySelector('section[aria-label="Theo sản phẩm"]')!;
    expect(section.querySelectorAll('li')).toHaveLength(10);
    expect(section.textContent).toContain('SP 1');
    expect(section.textContent).not.toContain('SP 12');
  });
});
