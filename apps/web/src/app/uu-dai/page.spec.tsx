import { homeCopy } from '@tubutree/app-core/home-copy';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';

// Chép ý pages/offers.spec của Mini App: thẻ Điểm Xanh, Điểm danh, lối tắt theo cờ, Mã giảm giá (rỗng, lỗi, cuộn), khách chưa đăng nhập.
const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  push: vi.fn(),
  search: '' as string,
  loyalty: null as Record<string, unknown> | null,
  coupons: [] as Record<string, unknown>[],
  checkIn: null as Record<string, unknown> | null,
  config: { waste: { enabled: true } } as Record<string, unknown>,
  fail: new Set<string>(),
  calls: [] as string[],
  posts: [] as string[],
  campaigns: [] as Record<string, unknown>[],
  campaignQueries: [] as unknown[],
  collectable: [] as Record<string, unknown>[],
  flash: [] as Record<string, unknown>[],
  use: vi.fn(),
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: state.phase === 'authenticated' ? { id: 'u1', pointsBalance: 120, pointsConvertedBalance: 0 } : null, retrySession: vi.fn() }),
}));
vi.mock('@/lib/use-coupon-use', () => ({ useCouponUse: () => ({ copy: vi.fn(), use: state.use, notice: null, cancel: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => '/uu-dai',
}));
vi.mock('@/lib/core-http', () => {
  const table: Record<string, () => unknown> = {
    '/me/loyalty': () => state.loyalty,
    '/me/coupons': () => state.coupons,
    '/me/daily-check-in': () => state.checkIn,
    '/config/public': () => state.config,
    '/campaigns': () => state.campaigns,
    '/coupons/collectable': () => state.collectable,
    '/coupons/collectable/mine': () => ({ claimed: [], newCustomerOnly: [] }),
    '/flash-sales/active': () => state.flash,
  };
  return {
    coreHttp: {
      get: async (path: string, opts?: unknown) => {
        state.calls.push(path);
        if (path === '/campaigns') state.campaignQueries.push(opts);
        if (state.fail.has(path)) throw new Error('Máy chủ đang bận');
        const h = table[path];
        if (!h) throw new Error(`đường dẫn lạ ${path}`);
        return h();
      },
      post: async (path: string) => {
        state.posts.push(path);
        return {
          points: { success: true, cycleDay: 3, streakDays: 3, pointsEarned: 3, totalPoints: 30, message: '' },
          water: { seedsEarned: 10, streakDays: 1, totalSeeds: 10, streakFrozeUsed: false, bonusNote: '' },
          alreadyDone: false,
          pending: [],
        };
      },
    },
  };
});

import { resetFlashSales } from '@/lib/use-flash-sales';
import OffersPage from './page';

const TIERS = [
  { id: 't1', name: 'Mầm Xanh', minPoints: 0, minSpending: 0, multiplier: 1 },
  { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, multiplier: 1.2 },
];
const REWARDS = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, points: day, claimed: day < 3, isToday: day === 3 }));
const COUPON = { id: 'c1', code: 'WELCOME20', type: 'AMOUNT', value: 20000, minOrder: 150000, endAt: '2026-12-31T00:00:00.000Z' };

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OffersPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
// Khối có tên: `aria-label` thẳng, hoặc `aria-labelledby` trỏ vào tiêu đề của khối.
const region = (c: HTMLElement, name: string) =>
  Array.from(c.querySelectorAll<HTMLElement>('section')).find((sec) => {
    const labelledBy = sec.getAttribute('aria-labelledby');
    const label = sec.getAttribute('aria-label') ?? (labelledBy ? sec.ownerDocument.getElementById(labelledBy)?.textContent : null);
    return label === name;
  }) ?? null;

const FLASH_ITEM = {
  itemId: 'f1', variationId: 'v1', productSlug: 'nuoc-rua-chen', productName: 'Nước rửa chén', thumbnail: null,
  retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 2, endAt: new Date(Date.now() + 3_600_000).toISOString(),
};
const OPEN_CODE = {
  code: 'NHAN10', title: null, type: 'AMOUNT', value: 10000, minOrder: null, maxDiscount: null,
  startAt: '2026-10-01T00:00:00.000Z', endAt: '2099-12-31T00:00:00.000Z', newCustomerOnly: false, claimedCount: 0, usageLimit: null,
};

beforeEach(() => {
  state.phase = 'authenticated';
  state.push.mockReset();
  state.search = '';
  state.loyalty = { tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0, tiers: TIERS, nextTier: { ...TIERS[1], pointsToGo: 80, spendingToGo: null }, totalSpent: 0 };
  state.coupons = [COUPON];
  state.checkIn = { checkedInToday: false, streakDays: 2, currentCycleDay: 3, rewards: REWARDS };
  state.config = { waste: { enabled: true } };
  state.fail = new Set();
  state.calls = [];
  state.posts = [];
  state.campaigns = [];
  state.campaignQueries = [];
  state.collectable = [];
  state.flash = [];
  state.use.mockReset();
  resetFlashSales();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/uu-dai — trang Ưu đãi', () => {
  it('Tích điểm đơn sàn: cờ bật thì có dòng sau Đổi rác, bấm mở thông báo chỉ Mini App, không điều hướng; cờ tắt thì không có', async () => {
    state.config = { waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
    const c = await mount();
    const shortcuts = region(c, 'Đổi quà')!;
    const titles = Array.from(shortcuts.querySelectorAll('[role="button"], button')).map((b) => b.textContent ?? '');
    const claim = titles.findIndex((t) => t.includes('Tích điểm đơn sàn'));
    expect(claim).toBeGreaterThan(titles.findIndex((t) => t.includes('Đổi rác lấy quà')));
    expect(claim).toBeLessThan(titles.findIndex((t) => t.includes('Mua chung nhóm')));
    expect(shortcuts.textContent).toContain('Quét mã trên phiếu giao hàng');
    expect(shortcuts.textContent).not.toContain('cần mở Tubu Tree trên Zalo');
    click(byText(shortcuts, '[role="button"], button', 'Tích điểm đơn sàn'));
    await flush(2);
    expect(shortcuts.textContent).toContain('cần mở Tubu Tree trên Zalo');
    expect(state.push).not.toHaveBeenCalled();
  });

  it('Tích điểm đơn sàn: cờ tắt thì không có dòng', async () => {
    state.config = { waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: false } };
    const c = await mount();
    expect(region(c, 'Đổi quà')!.textContent).not.toContain('Tích điểm đơn sàn');
  });

  it('khách đã đăng nhập: thẻ Điểm Xanh, Điểm danh, Đổi quà và tiện ích, Mã giảm giá của tôi; đúng một h1', async () => {
    const c = await mount();
    expect(region(c, 'Điểm Xanh của bạn')).not.toBeNull();
    expect(region(c, 'Điểm danh mỗi ngày')).not.toBeNull();
    expect(region(c, 'Đổi quà')).not.toBeNull();
    expect(region(c, 'Mã của tôi')).not.toBeNull();
    expect(c.querySelector('h1')!.textContent).toBe('Ưu đãi');
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });

  it('đang trong hạn giữ hạng: dòng giữ hạng, không vẽ thanh tiến độ lên hạng kế', async () => {
    state.loyalty = { ...(state.loyalty as object), tierGrace: { until: '2026-11-07T00:00:00.000Z', spendingToKeep: 400_000, pointsToKeep: 30_000 } };
    const c = await mount();
    const card = region(c, 'Điểm Xanh của bạn')!;
    expect(card.textContent).toContain('Giữ hạng Mầm Xanh: đơn giao thành công thêm 400.000đ trước 07/11/2026');
    expect(card.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('không trong hạn giữ hạng: vẫn có thanh tiến độ lên hạng kế', async () => {
    const c = await mount();
    expect(region(c, 'Điểm Xanh của bạn')!.querySelector('[role="progressbar"][aria-label="Tiến độ lên hạng kế"]')).not.toBeNull();
  });

  it('thẻ Điểm Xanh mở trang hạng và lịch sử điểm', async () => {
    const c = await mount();
    await flush(6);
    click(c.querySelector('button[aria-label$="Hạng và lịch sử điểm"]'));
    expect(state.push).toHaveBeenCalledWith('/tai-khoan/diem-xanh');
  });

  it('Điểm danh: chuỗi ngày, bảy ô thưởng; bấm nút gọi POST điểm danh một lần và báo kết quả', async () => {
    const c = await mount();
    const card = region(c, 'Điểm danh mỗi ngày')!;
    expect(card.textContent).toContain('Ngày 3/7');
    expect(card.textContent).toContain('N7');
    click(card.querySelector('button:not([disabled])'));
    click(card.querySelector('button'));
    await flush(6);
    expect(state.posts.filter((p) => p === '/me/daily-check-in')).toHaveLength(1);
    expect(card.textContent).toContain('+3 Điểm Xanh · +10 giọt nước');
  });

  it('đã điểm danh hôm nay: nút khoá', async () => {
    state.checkIn = { checkedInToday: true, streakDays: 3, currentCycleDay: 3, rewards: REWARDS };
    const c = await mount();
    const btn = region(c, 'Điểm danh mỗi ngày')!.querySelector('button')!;
    expect(btn.disabled || btn.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('lịch điểm danh lỗi: dòng báo + Thử lại, các khối khác vẫn hiện', async () => {
    state.fail.add('/me/daily-check-in');
    const c = await mount();
    expect(region(c, 'Điểm danh mỗi ngày')!.textContent).toContain('Chưa tải được lịch điểm danh');
    expect(region(c, 'Mã của tôi')!.textContent).toContain('Giảm');
  });

  it('lối tắt dẫn đúng route web; Đổi rác theo cờ; không có "Tích điểm đơn sàn" vì web chưa có trang', async () => {
    const c = await mount();
    const rows = region(c, 'Đổi quà')!;
    for (const [label, to] of [['Đổi quà', '/kho-qua'], ['Quà của tôi', '/kho-qua/cua-toi'], ['Đổi rác lấy quà', '/doi-rac'], ['Mua chung nhóm', '/mua-chung'], ['Vườn Xanh', '/vuon-xanh']] as const) {
      const row = Array.from(rows.querySelectorAll<HTMLElement>('[role="button"]')).find((r) => r.textContent?.includes(label))!;
      expect(row, label).toBeTruthy();
      click(row);
      expect(state.push).toHaveBeenLastCalledWith(to);
    }
    expect(rows.textContent).not.toContain('Tích điểm đơn sàn');
  });

  it('cờ Đổi rác tắt: ẩn dòng Đổi rác', async () => {
    state.config = { waste: { enabled: false } };
    const c = await mount();
    expect(region(c, 'Đổi quà')!.textContent).not.toContain('Đổi rác lấy quà');
  });

  it('Mã của tôi: thẻ phiếu có nhãn, điều kiện, hạn dùng và số mã; rỗng thì có câu hướng dẫn', async () => {
    let c = await mount();
    const coupons = region(c, 'Mã của tôi')!;
    expect(coupons.textContent).toContain('Giảm 20k');
    expect(coupons.textContent).not.toMatch(/\b1 mã/);
    expect(coupons.querySelector('[data-testid="voucher-meta"]')!.textContent).toContain('Đơn từ 150k');
    mounted.pop()!.unmount();
    state.coupons = [];
    c = await mount();
    expect(region(c, 'Mã của tôi')!.textContent).toContain('Chưa có mã giảm giá khả dụng');
  });

  it('Mã của tôi chỉ xếp 3 phiếu; từ 4 mã trở lên nút ghi "Tất cả (n)", tên đọc vẫn là "Xem tất cả Mã của tôi"', async () => {
    state.coupons = Array.from({ length: 8 }, (_, i) => ({ ...COUPON, code: `MA-${i}`, value: 10_000 * (i + 1) }));
    const c = await mount();
    const mine = region(c, 'Mã của tôi')!;
    expect(mine.querySelectorAll('[role="group"]')).toHaveLength(3);
    const all = mine.querySelector('button[aria-label="Xem tất cả Mã của tôi"]')!;
    expect(all.textContent).toBe('Tất cả (8)');
    click(all);
    expect(state.push).toHaveBeenLastCalledWith('/ma-giam-gia?tab=mine');
    mounted.pop()!.unmount();
    state.coupons = state.coupons.slice(0, 3);
    const d = await mount();
    const three = region(d, 'Mã của tôi')!;
    expect(three.querySelectorAll('[role="group"]')).toHaveLength(3);
    expect(three.querySelector('button[aria-label="Xem tất cả Mã của tôi"]')!.textContent).toBe('Xem tất cả');
  });

  it('Mã của tôi lỗi: thông báo có lý do và nút Thử lại', async () => {
    state.fail.add('/me/coupons');
    const c = await mount();
    expect(region(c, 'Mã của tôi')!.textContent).toContain('Chưa tải được mã giảm giáMáy chủ đang bận');
    expect(byText(region(c, 'Mã của tôi')!, 'button', 'Thử lại')).not.toBeNull();
  });

  it('Mã của tôi: mỗi thẻ có nút "Dùng ngay" gọi use đúng mã; "Xem tất cả" tới /ma-giam-gia?tab=mine', async () => {
    const c = await mount();
    const mine = region(c, 'Mã của tôi')!;
    click(byText(mine, 'button', 'Dùng ngay'));
    expect(state.use).toHaveBeenCalledWith('WELCOME20');
    click(mine.querySelector('button[aria-label="Xem tất cả Mã của tôi"]'));
    expect(state.push).toHaveBeenLastCalledWith('/ma-giam-gia?tab=mine');
  });

  it('thứ tự trang theo Q10: Banner, Giờ vàng, Nhận mã, Điểm Xanh, Mã của tôi, Đổi quà', async () => {
    state.campaigns = [campaign('a')];
    state.flash = [FLASH_ITEM];
    state.collectable = [OPEN_CODE];
    const c = await mount();
    const blocks = [
      c.querySelector('[data-offers-banner]'),
      region(c, 'Giờ vàng hôm nay'),
      region(c, 'Nhận mã'),
      region(c, 'Điểm Xanh của bạn'),
      region(c, 'Mã của tôi'),
      region(c, 'Đổi quà'),
    ];
    blocks.forEach((b, i) => expect(b, `khối ${i}`).not.toBeNull());
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i - 1]!.compareDocumentPosition(blocks[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `khối ${i}`).toBeTruthy();
    }
  });

  it('khung trang rộng (PAGE_WIDE, không khung hẹp Tài khoản); từ lg: hàng Điểm Xanh | Điểm danh hai cột, Mã của tôi lưới ba cột', async () => {
    const c = await mount();
    const main = c.querySelector('main')!;
    expect(main.className).toContain('max-w-frame');
    expect(main.className).not.toContain('max-w-3xl');
    expect(main.querySelector(':scope > header h1')!.textContent).toBe('Ưu đãi');
    const row = c.querySelector('[data-testid="offers-points-row"]')!;
    expect(row.className).toContain('lg:grid-cols-2');
    expect(row.contains(region(c, 'Điểm Xanh của bạn'))).toBe(true);
    expect(row.contains(region(c, 'Điểm danh mỗi ngày'))).toBe(true);
    expect(c.querySelector('[data-testid="offers-mine-grid"]')!.className).toContain('lg:grid-cols-3');
  });

  it('Nhận mã: khách đã đăng nhập không thấy mã đã có trong ví; "Lưu mã" ở khối này đi qua claim', async () => {
    state.collectable = [{ ...OPEN_CODE, code: 'WELCOME20' }, OPEN_CODE];
    const c = await mount();
    const collect = region(c, 'Nhận mã')!;
    expect(collect.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(collect.textContent).toContain('NHAN10');
  });

  it('?section=coupons cuộn tới danh sách mã sau khi tải xong', async () => {
    state.search = 'section=coupons';
    await mount();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('khách chưa đăng nhập: vẫn thấy Giờ vàng và Nhận mã, rồi lời mời đăng nhập thay các khối cần tài khoản; không gọi API riêng của khách', async () => {
    state.phase = 'guest';
    state.flash = [FLASH_ITEM];
    state.collectable = [OPEN_CODE];
    const c = await mount();
    const flash = region(c, 'Giờ vàng hôm nay')!;
    const collect = region(c, 'Nhận mã')!;
    expect(flash).not.toBeNull();
    expect(collect).not.toBeNull();
    expect(c.textContent).toContain('Đăng nhập để xem ưu đãi');
    const login = c.querySelector('a[href^="/dang-nhap"]')!;
    expect(login).not.toBeNull();
    expect(flash.compareDocumentPosition(collect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(collect.compareDocumentPosition(login) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Giống Mini App: các khối cần tài khoản không có, kể cả lối tắt.
    expect(region(c, 'Điểm Xanh của bạn')).toBeNull();
    expect(region(c, 'Mã của tôi')).toBeNull();
    expect(c.textContent).not.toContain(homeCopy.offers.rewardsTitle);
    expect(c.textContent).not.toContain('Vườn Xanh');
    expect(c.textContent).not.toContain(homeCopy.offers.myRewards);
    expect(state.calls.filter((p) => !['/config/public', '/campaigns', '/flash-sales/active', '/coupons/collectable'].includes(p))).toEqual([]);
  });

  it('khách chưa đăng nhập bấm "Lưu mã": đi tới đăng nhập kèm returnTo=/uu-dai, không gọi POST claim', async () => {
    state.phase = 'guest';
    state.collectable = [OPEN_CODE];
    const c = await mount();
    click(byText(region(c, 'Nhận mã')!, 'button', 'Lưu mã'));
    await flush(2);
    expect(state.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fuu-dai');
    expect(state.posts).toEqual([]);
  });

  it('phiên chưa khôi phục: khối công khai vẫn vẽ, phần còn lại là khung chờ (không mời đăng nhập vội)', async () => {
    state.phase = 'loading';
    state.collectable = [OPEN_CODE];
    const c = await mount();
    expect(c.querySelector('a[href^="/dang-nhap"]')).toBeNull();
    expect(c.querySelector('[data-testid="offers-page-loading"]')).not.toBeNull();
  });
});

const campaign = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: `chien-dich-${id}`,
  title: `Chiến dịch ${id}`,
  image: `https://img.test/${id}.jpg`,
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: '2020-01-01T00:00:00Z',
  endAt: '2099-01-01T00:00:00Z',
  ...over,
});

describe('/uu-dai — banner đầu trang (OFFERS_TOP)', () => {
  const links = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLAnchorElement>('[data-offers-banner] a[href]')).map((a) => a.getAttribute('href'));

  it('có chiến dịch: một khối banner ngay dưới tiêu đề trang, xin placement=OFFERS_TOP không đăng nhập, bấm sang /chien-dich/[slug]', async () => {
    state.campaigns = [campaign('a')];
    const c = await mount();
    expect(state.campaignQueries).toEqual([{ query: { placement: 'OFFERS_TOP' }, anonymous: true }]);
    expect(links(c)).toEqual(['/chien-dich/chien-dich-a']);
    const h1 = c.querySelector('h1')!;
    const banner = c.querySelector('[data-offers-banner]')!;
    expect(h1.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.compareDocumentPosition(region(c, 'Điểm Xanh của bạn')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('khách chưa đăng nhập cũng thấy banner (công khai), kèm lời mời đăng nhập bên dưới', async () => {
    state.phase = 'guest';
    state.campaigns = [campaign('a')];
    const c = await mount();
    expect(links(c)).toEqual(['/chien-dich/chien-dich-a']);
    expect(c.textContent).toContain('Đăng nhập để xem ưu đãi');
  });

  it('lần trước có banner Ưu đãi và đang tải: giữ chỗ bằng khung chờ, là khối đầu tiên', async () => {
    localStorage.setItem('tubu_offers_banner', '1');
    state.campaigns = [campaign('a')];
    state.flash = [FLASH_ITEM];
    // Ngay lượt vẽ đầu (banner còn đang tải) khung chờ phải có mặt và là khối đầu tiên dưới tiêu đề; banner về thì khung biến mất mà Giờ vàng vẫn còn.
    const r = render(<OffersPage />);
    mounted.push(r);
    const frame = r.container.querySelector('[data-testid="offers-banner-loading"]');
    expect(frame).not.toBeNull();
    expect(frame!.parentElement!.firstElementChild).toBe(frame);
    await flush(8);
    expect(r.container.querySelector('[data-testid="offers-banner-loading"]')).toBeNull();
    expect(region(r.container, 'Giờ vàng hôm nay')).not.toBeNull();
  });

  it('không có chiến dịch: ẩn hẳn, không khối rỗng', async () => {
    const c = await mount();
    expect(c.querySelector('[data-offers-banner]')).toBeNull();
  });

  it('/campaigns lỗi: ẩn hẳn, không báo lỗi, phần còn lại của trang vẫn đủ', async () => {
    state.fail = new Set(['/campaigns']);
    const c = await mount();
    expect(c.querySelector('[data-offers-banner]')).toBeNull();
    expect(c.textContent).not.toContain('Máy chủ đang bận');
    expect(region(c, 'Điểm Xanh của bạn')).not.toBeNull();
  });

  it('theo loại khách đã nhớ trên máy: khách cũ thấy chiến dịch RETURNING, không thấy NEW; khách chưa nhớ loại chỉ thấy chiến dịch cho mọi người', async () => {
    state.campaigns = [campaign('all'), campaign('moi', { audience: 'NEW' }), campaign('cu', { audience: 'RETURNING' })];
    localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'u1', kind: 'returning' }));
    expect(links(await mount())).toEqual(['/chien-dich/chien-dich-all', '/chien-dich/chien-dich-cu']);
    mounted.forEach((m) => m.unmount());
    mounted = [];
    localStorage.clear();
    expect(links(await mount())).toEqual(['/chien-dich/chien-dich-all']);
  });
});
