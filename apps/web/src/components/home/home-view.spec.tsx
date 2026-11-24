// @vitest-environment jsdom
import { StrictMode, act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { newTestClient } from '@/test-utils/render-hook';
import { ApiError } from '@/lib/client-api';
import { __resetDeferForTest } from './defer-until-near';

// Chép ý nghĩa pages/home.spec của Mini App (phương án A, 9 khối): thứ tự khối theo khách cũ/mới, một lưới gợi ý, khối lỗi + Thử lại, lỗi cấp trang, khách vãng lai, chuông.
const mocks = vi.hoisted(() => ({ get: vi.fn(), push: vi.fn(), phase: 'authenticated', restoring: false, user: { id: 'u1', fullName: 'Lan', pointsBalance: 0 } as unknown }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: { get: mocks.get, post: vi.fn(), delete: vi.fn() },
  rawCoreHttp: { get: mocks.get, post: vi.fn(), delete: vi.fn() },
  setCoreGetInterceptor: vi.fn(),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase, useAuthRestoring: () => mocks.restoring }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: mocks.phase === 'authenticated' ? mocks.user : null }) }));
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/' }));
const routeState = vi.hoisted(() => ({ pending: new Set<string>() }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => !routeState.pending.has(p) }));

import HomeView from './home-view-client';
import { homeBlockOrder } from './home-blocks';
import { HOME_CONTEXT_HEIGHT, HOME_MAX_BLOCKS, HOME_SETTLE_MAX_MS, homeKeptOrder, homeRenderOrder } from '@tubutree/app-core/home-layout';
import { resetFlashSales } from '@/lib/use-flash-sales';
import { HOME_KIND_KEY } from './use-home-customer-kind';
import { BANNER_HINT_KEY, HOME_BEST_SELLER_LIMIT } from '@tubutree/app-core/home-layout';
import type { CampaignBanner } from '@tubutree/app-core/api/campaign';

// Kệ Mua lại của Trang chủ chỉ lấy đơn trong 90 ngày: ngày mua tính theo đồng hồ lúc chạy (hôm qua), không ghim ngày cố định sẽ trôi ra ngoài cửa sổ.
const RECENT_PURCHASE = new Date(Date.now() - 86_400_000).toISOString();

const CONFIG = {
  freeshipThreshold: 350_000, subscribeDiscountPct: 0.17, affiliateWalletMultiplier: 1, cashbackHoldDays: 30,
  loyalty: { vndPerPoint: 20_000, vndPerPointRedeem: 1_000 },
};
const card = (id: string, name: string) => ({ id, slug: id, brand: 'Tubu', name, thumbnail: null as string | null, basePrice: 50000, salePrice: null, isFeatured: true, inStock: true });
const PAGE = (items: ReturnType<typeof card>[]) => ({ data: items, meta: { page: 1, limit: 6, total: items.length } });
/** Ba món bán chạy (kệ Bán chạy nhất chỉ hiện từ 3 món), khác slug với Giờ vàng và lưới gợi ý. */
const BEST = () => PAGE([card('bs1', 'Hạng nhất A'), card('bs2', 'Hạng nhì B'), card('bs3', 'Hạng ba C')]);
const FEED = 'Khám phá theo Thương hiệu';
/** Ba nhãn của khối "Khám phá theo Thương hiệu" (thẻ chen đứng sau nhãn thứ hai); Fuwa3e có cả món đang ở kệ Bán chạy nhất. */
const BRANDS = [
  { brand: 'Fuwa3e', count: 20, slug: 'fuwa3e' },
  { brand: 'Tubu Tree', count: 30, slug: null },
  { brand: 'Pơ Lang', count: 6, slug: null },
];
const BRAND_PAGE = (brand: string) => {
  const key = brand.toLowerCase().replace(/\W+/g, '');
  const own = Array.from({ length: 4 }, (_, i) => card(`${key}${i + 1}`, `${brand} số ${i + 1}`));
  return PAGE(brand === 'Fuwa3e' ? [card('bs1', 'Hạng nhất A'), ...own] : own);
};
const CATEGORIES = [{ id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4, children: [] }];

type Handler = (query?: Record<string, unknown>) => unknown;
let routes: Record<string, Handler>;
const calls = (path: string) => mocks.get.mock.calls.filter(([p]) => p === path);
const productCalls = () => calls('/products').map(([, o]) => (o as { query: Record<string, unknown> }).query);

let mounted: Rendered | null = null;
const mount = async (ui = <HomeView />) => {
  mounted = render(<QueryClientProvider client={newTestClient()}>{ui}</QueryClientProvider>);
  await flush(10);
  return mounted.container;
};
const blockOrder = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-home-block]')).map((el) => el.dataset.homeBlock);
const block = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-home-block="${id}"]`)!;
const region = (c: HTMLElement, name: string) => c.querySelector(`section[aria-label="${name}"]`);
/** Tên khối ghi ở `data-home-block`: dải ngữ cảnh mang tên biến thể đang hiện (giữ tên cũ), ô khuyến mãi mang tên khối nó vẽ và không có vỏ khi không có gì để vẽ. */
const named = (order: readonly string[], context: 'welcome' | 'todo' | 'member', promo: string | null = null) =>
  order.flatMap((id) => (id === 'context' ? [context] : id === 'promo' ? (promo ? [promo] : []) : [id]));

beforeEach(() => {
  localStorage.clear();
  resetFlashSales();
  routeState.pending = new Set();
  mocks.phase = 'authenticated';
  mocks.restoring = false;
  mocks.user = { id: 'u1', fullName: 'Lan', pointsBalance: 0 };
  mocks.push.mockReset();
  routes = {
    '/products': (q) => (q?.brand ? BRAND_PAGE(String(q.brand)) : q?.sort === 'best_seller_30d' ? BEST() : PAGE([card('f1', 'Trùng gợi ý'), card('f2', 'Chỉ nổi bật')])),
    '/products/for-you': () => [card('f1', 'Trùng gợi ý')],
    '/brands': () => BRANDS,
    '/categories': () => CATEGORIES,
    '/me/summary': () => ({ orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: 0 }, unreadNotifications: 0, activeSubscriptions: 0 }),
    '/me/purchased-items': () => ({ items: [], nextCursor: null }),
    '/config/public': () => CONFIG,
    '/me/new-customer-offer': () => ({ isNewCustomer: true, welcomeVoucher: null }),
    '/me/subscriptions': () => [],
    '/me/loyalty': () => ({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 }),
    '/me/coupons': () => [],
    '/me/daily-check-in': () => ({ checkedInToday: true, streakDays: 1, currentCycleDay: 1, rewards: [] }),
    '/feed': () => ({ posts: [] }),
    '/flash-sales/active': () => [],
    '/flash-sales/upcoming': () => [],
    '/campaigns': () => [],
    '/bundles/combos': () => [],
  };
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: Record<string, unknown> }) => {
    const h = routes[path];
    if (!h) throw new Error(`đường dẫn lạ ${path}`);
    return h(opts?.query);
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('HomeView — thứ tự khối (9 khối, một lưới gợi ý)', () => {
  it('khách mới: Quà khách mới thay thẻ thành viên, có kệ Bán chạy, không có Mua lại; thứ tự đúng homeBlockOrder("new"), không có ô khuyến mãi khi không có gì để vẽ', async () => {
    const c = await mount();
    expect(blockOrder(c)).toEqual(named(homeBlockOrder('new'), 'welcome'));
    expect(blockOrder(c)).not.toContain('promo');
    expect(block(c, 'member')).toBeNull();
    expect(region(c, 'Bán chạy nhất')).not.toBeNull();
    expect(calls('/me/purchased-items')[0]![1]).toEqual({ query: { limit: 10 } });
  });

  it('khách cũ: thứ tự "returning" sau khi purchased-items có hàng; thẻ thành viên có mặt, Quà khách mới không', async () => {
    routes['/me/purchased-items'] = () => ({ items: [{ variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: RECENT_PURCHASE }], nextCursor: null });
    const c = await mount();
    expect(blockOrder(c)).toEqual(named(homeBlockOrder('returning'), 'member'));
    expect(region(c, 'Thẻ thành viên')).not.toBeNull();
    expect(region(c, 'Quà khách mới')).toBeNull();
    expect(region(c, 'Mua lại')).not.toBeNull();
  });

  it('Mua lại bỏ phân loại đang Giờ vàng mà kệ không vẽ thẻ riêng (phân loại thứ hai của cùng sản phẩm), vẫn giữ món khác (H3 #2)', async () => {
    const flashItem = (slug: string, variationId: string) => ({
      itemId: `i-${variationId}`, variationId, productSlug: slug, productName: `Giờ vàng ${slug}`, thumbnail: null,
      retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 1, endAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const bought = (slug: string, variationId: string, productName: string) => ({ variationId, productId: `p-${slug}`, slug, productName, variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: RECENT_PURCHASE });
    routes['/flash-sales/active'] = () => [flashItem('a', 'v-a-1l'), flashItem('b', 'v-b'), flashItem('c', 'v-c'), flashItem('a', 'v-a-5l')];
    routes['/me/purchased-items'] = () => ({ items: [bought('a', 'v-a-5l', 'Đã mua Can 5L'), bought('x', 'v-x', 'Đã mua món khác')], nextCursor: null });
    const c = await mount();
    const rail = region(c, 'Mua lại');
    expect(rail).not.toBeNull();
    expect(rail!.textContent).toContain('Đã mua món khác');
    expect(rail!.textContent).not.toContain('Đã mua Can 5L');
  });

  it('khách cũ đã được nhớ: ngay từ khung hình đầu đã theo thứ tự returning, dù purchased-items còn tải', async () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    routes['/me/purchased-items'] = () => new Promise(() => undefined);
    const c = await mount();
    expect(blockOrder(c)).toEqual(named(homeBlockOrder('returning'), 'member'));
    expect(calls('/me/new-customer-offer')).toHaveLength(0);
  });

  it('đang khôi phục phiên + đã nhớ khách cũ: bố cục khách cũ ngay (khung chờ thẻ thành viên và kệ Mua lại), Bán chạy nhất vẫn có (kệ công khai), không gọi API khách', async () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    mocks.phase = 'loading';
    mocks.restoring = true;
    const c = await mount();
    expect(blockOrder(c)).toEqual(named(homeBlockOrder('returning'), 'member'));
    expect(c.querySelector('[data-testid="member-card-loading"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="purchased-rail-loading"]')).not.toBeNull();
    expect(region(c, 'Bán chạy nhất')).not.toBeNull();
    expect(calls('/me/purchased-items')).toHaveLength(0);
  });

  it('đang khôi phục phiên, chưa nhớ gì: chưa biết (khung chờ trung tính), không dựng bố cục khách mới', async () => {
    mocks.phase = 'loading';
    mocks.restoring = true;
    const c = await mount();
    expect(blockOrder(c)).toEqual(named(homeRenderOrder('unknown', true), 'member'));
    expect(region(c, 'Bán chạy nhất')).toBeNull();
    expect(region(c, 'Quà khách mới')).toBeNull();
  });

  it('khách mới nhưng API báo không còn là khách mới → không hiện Quà khách mới', async () => {
    routes['/me/new-customer-offer'] = () => ({ isNewCustomer: false, welcomeVoucher: null });
    const c = await mount();
    expect(region(c, 'Quà khách mới')).toBeNull();
  });
});

describe('HomeView — nội dung các khối', () => {
  it('"Bán chạy nhất" xin sort=best_seller_30d, HOME_BEST_SELLER_LIMIT món, có hạng #1..#3, cho cả khách cũ; khối thương hiệu xin 8 món bán chạy mỗi nhãn, không gọi newest/nổi bật/lưới theo ngày', async () => {
    const c = await mount();
    const calledSorts = productCalls().map((q) => q.sort);
    expect(calledSorts).not.toContain('newest');
    expect(calledSorts).not.toContain(undefined);
    const best = productCalls().find((q) => q.sort === 'best_seller_30d' && !q.brand)!;
    expect(best.limit).toBe(HOME_BEST_SELLER_LIMIT);
    const shelf = region(c, 'Bán chạy nhất')!;
    expect(shelf.textContent).toContain('Hạng nhất A');
    for (const rank of ['#1', '#2', '#3']) expect(shelf.textContent).toContain(rank);
    expect(productCalls().filter((q) => q.brand)).toEqual(['Fuwa3e', 'Pơ Lang', 'Tubu Tree'].map((brand) => ({ brand, sort: 'best_seller_30d', limit: 8 })));
  });

  it('khối "Khám phá theo Thương hiệu" thay lưới Gợi ý: mỗi nhãn một mục (nhiều sản phẩm trước, "Tubu Tree" cuối), không lặp món đã ở kệ trên', async () => {
    const c = await mount();
    expect(region(c, 'Gợi ý hôm nay')).toBeNull();
    const feed = region(c, FEED)!;
    expect(Array.from(feed.querySelectorAll('h3')).map((h) => h.textContent)).toEqual(['Fuwa3e', 'Pơ Lang', 'Tubu Tree']);
    const fuwa = feed.querySelector<HTMLElement>('#home-brand-fuwa3e')!;
    expect(fuwa.textContent).toContain('Fuwa3e số 4');
    expect(fuwa.textContent).not.toContain('Hạng nhất A');
  });

  it('chip thương hiệu dưới Danh mục cuộn tới đúng mục nhãn trong khối (khối đã dựng), không đổi trang', async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    try {
      const c = await mount();
      click(byText(c.querySelector('[data-testid="home-brand-bar"]')!, 'button', 'Pơ Lang'));
      expect(scrolled).toEqual(['home-brand-polang']);
      expect(mocks.push).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  const feedItems = (c: HTMLElement) => Array.from(region(c, FEED)!.querySelector('[data-testid="home-brand-section"]')!.parentElement!.children) as HTMLElement[];

  it('ngày chẵn: Chẩn đoán tổ ấm đứng trong khối thương hiệu sau nhãn cuối (không còn là khối riêng), có h2 và nút Bắt đầu, chưa gọi API quà', async () => {
    const c = await mount(<HomeView initial={{ suggestSeed: '20261102' }} />);
    expect(blockOrder(c)).not.toContain('quiz');
    expect(blockOrder(c)).not.toContain('community');
    const items = feedItems(c);
    const at = items.findIndex((el) => el.dataset.testid === 'suggest-interleave');
    expect(at).toBe(items.length - 1);
    expect(items[at - 1]!.dataset.testid).toBe('home-brand-section');
    expect(items[at]!.querySelector('h2')!.textContent).toBe('Chẩn đoán tổ ấm');
    expect(items[at]!.querySelector('button')!.textContent).toBe('Bắt đầu');
    expect(calls('/game/home-quiz/complete')).toEqual([]);
  });

  it('ngày lẻ: Cộng đồng thay Chẩn đoán ở đúng chỗ chen đó', async () => {
    routes['/feed'] = () => ({ posts: [{ id: 'p1', title: 'Hỏi về dầu gội', body: '', author: 'Mai', createdAt: new Date().toISOString(), commentCount: 2 }] });
    const c = await mount(<HomeView initial={{ suggestSeed: '20261101' }} />);
    const feed = region(c, FEED)!;
    expect(feed.textContent).not.toContain('Chẩn đoán tổ ấm');
    const items = feedItems(c);
    const at = items.findIndex((el) => el.dataset.testid === 'suggest-interleave');
    expect(at).toBe(items.length - 1);
    expect(items[at]!.querySelector('section[aria-label="Cộng đồng hỏi đáp"], section')!.textContent).toContain('Hỏi về dầu gội');
  });

  it('Cộng đồng chưa có bài: ô chen rỗng và ẩn (empty:hidden), không để lại khoảng trống cuối khối', async () => {
    const c = await mount(<HomeView initial={{ suggestSeed: '20261101' }} />);
    const slot = feedItems(c).find((el) => el.dataset.testid === 'suggest-interleave')!;
    expect(slot.className).toContain('empty:hidden');
    expect(slot.childElementCount).toBe(0);
  });

  it('chỉ một thương hiệu: thẻ chen vẫn đứng sau nhãn đó', async () => {
    routes['/brands'] = () => BRANDS.slice(0, 1);
    const c = await mount(<HomeView initial={{ suggestSeed: '20261102' }} />);
    expect(feedItems(c).map((el) => el.dataset.testid)).toEqual(['home-brand-section', 'suggest-interleave']);
    expect(region(c, FEED)!.textContent).toContain('Chẩn đoán tổ ấm');
  });

  it('tối đa 9 khối ở tổ hợp đông nhất (khách cũ + Giờ vàng đang chạy), và dải ngữ cảnh luôn cao tối thiểu HOME_CONTEXT_HEIGHT', async () => {
    routes['/me/purchased-items'] = () => ({ items: [{ variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: RECENT_PURCHASE }], nextCursor: null });
    const flash = ['fa', 'fb', 'fc'].map((slug) => ({
      itemId: `i-${slug}`, variationId: `v-${slug}`, productSlug: slug, productName: `Giờ vàng ${slug}`, thumbnail: null,
      retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 1, endAt: new Date(Date.now() + 3_600_000).toISOString(),
    }));
    routes['/flash-sales/active'] = () => flash;
    const c = await mount(<HomeView initial={{ flash }} />);
    expect(blockOrder(c)).toEqual(named(homeBlockOrder('returning'), 'member', 'flash'));
    expect(blockOrder(c)).toHaveLength(HOME_MAX_BLOCKS);
    expect(block(c, 'member').style.minHeight).toBe(`${HOME_CONTEXT_HEIGHT}px`);
  });

  it('khối quiz của người đã đăng nhập không thêm request nào ở Trang chủ (không gọi /game/arcade/status, chỉ đọc bộ nhớ đệm)', async () => {
    mocks.phase = 'authenticated';
    await mount();
    expect(calls('/game/arcade/status')).toEqual([]);
    expect(mocks.get.mock.calls.filter(([p]) => String(p).startsWith('/game/'))).toEqual([]);
  });

  it('"Bán chạy nhất" có nút Xem tất cả sang /ban-chay', async () => {
    const c = await mount();
    const seeAll = c.querySelector<HTMLAnchorElement>('a[aria-label="Xem tất cả Bán chạy nhất"]');
    expect(seeAll?.getAttribute('href')).toBe('/ban-chay');
  });

  it('khối cách nhau bằng lề ở vỏ khối (space-block), không phải đệm trong khối; ô tìm dính và khung chờ không có lề', async () => {
    const c = await mount();
    for (const el of Array.from(c.querySelectorAll<HTMLElement>('[data-home-block]'))) {
      const id = el.dataset.homeBlock;
      if (id === 'search') expect(el.style.marginTop).toBe('');
      else if (id !== 'pageError') expect(el.style.marginTop || el.parentElement?.style.marginTop, id).toBe('var(--space-block)');
    }
  });

  it('ô tìm là vỏ: dẫn sang /san-pham?focus=search; chạm danh mục sang /san-pham lọc theo danh mục', async () => {
    const c = await mount();
    const search = c.querySelector('a[aria-label="Bạn tìm gì hôm nay?"]');
    expect(search?.getAttribute('href')).toBe('/san-pham?focus=search');
    // D7-31: từ md thanh đầu website đã có ô tìm, ô này chỉ còn ở điện thoại.
    expect(search?.parentElement?.className).toMatch(/\bmd:hidden\b/);
    click(byText(c, 'button', 'Dầu gội'));
    expect(mocks.push).toHaveBeenCalledWith('/san-pham?category=c-goi');
  });

  it('chưa có danh mục thật → lưới 4 phân khúc, chạm sang ?segment=', async () => {
    routes['/categories'] = () => [];
    const c = await mount();
    click(byText(c, 'button', 'Chăm sóc cá nhân'));
    expect(mocks.push).toHaveBeenCalledWith('/san-pham?segment=skincare');
  });
});

describe('HomeView — HubLayout cho máy tính', () => {
  const hubPart = (c: HTMLElement, name: string) => c.querySelector<HTMLElement>(`[data-hub-part="${name}"]`)!;

  it('dải ngữ cảnh (quà khách mới, Việc cần làm hay thẻ thành viên) là MỘT khối trong aside của lưới 12 cột; ô tìm ở NGOÀI lưới (phải là con trực tiếp của trang để dính); phần còn lại ở children', async () => {
    const c = await mount();
    const hub = c.querySelector<HTMLElement>('[data-testid="hub-layout"]')!;
    expect(hub).not.toBeNull();
    expect(hub.contains(block(c, 'search'))).toBe(false);
    const aside = hubPart(c, 'aside');
    expect(Array.from(aside.querySelectorAll('[data-home-block]')).map((el) => (el as HTMLElement).dataset.homeBlock)).toEqual(['welcome']);
    const rest = hubPart(c, 'rest');
    expect(rest.contains(block(c, 'shortcuts'))).toBe(true);
    expect(rest.contains(block(c, 'suggest'))).toBe(true);
    expect(rest.contains(block(c, 'welcome'))).toBe(false);
  });

  it('HubLayout không còn cột banner: hero giới thiệu mặc định (từ md) chiếm chỗ cạnh aside 4 cột, kể cả khi có banner; banner nằm trong ô khuyến mãi', async () => {
    const c = await mount();
    expect(c.querySelector('[data-hub-part="banner"]')).toBeNull();
    const hero = hubPart(c, 'hero');
    expect(hero.className).toEqual(expect.stringContaining('hidden md:block'));
    expect(hero.className).toContain('lg:col-span-8');
    expect(hero.querySelector('[data-testid="home-editorial-hero"]')).not.toBeNull();
    expect(hubPart(c, 'aside').className).toContain('lg:col-span-4');
    expect(blockOrder(c)).not.toContain('banner');
  });

  it('Bento Hub hiện ở cả máy tính lẫn điện thoại (không bị md:hidden che ở md+): 5 trụ cột khi chưa có suất Giờ vàng, thẻ Giờ vàng chỉ hiện khi có', async () => {
    const c = await mount();
    const section = block(c, 'shortcuts').querySelector('section');
    expect(section?.className ?? '').not.toContain('md:hidden');
    const ids = Array.from(block(c, 'shortcuts').querySelectorAll<HTMLElement>('[data-pillar]')).map((el) => el.dataset.pillar);
    expect(ids).toHaveLength(5);
    expect(ids).not.toContain('retail');
  });

  it('có suất Giờ vàng sắp tới: thẻ Mua lẻ · Giờ vàng quay lại, đủ 6 trụ cột', async () => {
    routes['/flash-sales/upcoming'] = () => [{ itemId: 'u1', variationId: 'vu', productSlug: 'u', productName: 'Sắp tới', thumbnail: null, retailPrice: 100000, flashPrice: 80000, startAt: new Date(Date.now() + 3_600_000).toISOString(), reminded: false }];
    const c = await mount();
    expect(block(c, 'shortcuts').querySelectorAll('[data-pillar]')).toHaveLength(6);
  });

  it('máy chủ đã hỏi suất đang chạy và sắp mở: hàng lối tắt giữ đúng quyết định của HTML đầu suốt lượt xem, không đổi theo câu trả lời về sau ở trình duyệt', async () => {
    routes['/flash-sales/upcoming'] = () => [{ itemId: 'u1', variationId: 'vu', productSlug: 'u', productName: 'Sắp tới', thumbnail: null, retailPrice: 100000, flashPrice: 80000, startAt: new Date(Date.now() + 3_600_000).toISOString(), reminded: false }];
    const none = await mount(<HomeView initial={{ flash: [], flashUpcomingCount: 0 }} />);
    expect(block(none, 'shortcuts').querySelectorAll('[data-pillar]')).toHaveLength(5);
    mounted?.unmount();
    routes['/flash-sales/upcoming'] = () => [];
    const some = await mount(<HomeView initial={{ flash: [], flashUpcomingCount: 2 }} />);
    expect(block(some, 'shortcuts').querySelectorAll('[data-pillar]')).toHaveLength(6);
  });
});

const campaign = (id: string, over: Partial<CampaignBanner> = {}): CampaignBanner => ({
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
const calledCampaigns = () => calls('/campaigns');

describe('HomeView — banner chiến dịch (P11)', () => {
  const hubPart = (c: HTMLElement, name: string) => c.querySelector<HTMLElement>(`[data-hub-part="${name}"]`);
  const bannerLinks = (c: HTMLElement) => Array.from(block(c, 'banner').querySelectorAll<HTMLAnchorElement>('a[href]'));

  it('có chiến dịch trong dữ liệu server: banner có ngay (không gọi lại /campaigns), liên kết sang /chien-dich/[slug], ảnh có tên đọc', async () => {
    const c = await mount(<HomeView initial={{ campaigns: [campaign('a')] }} />);
    expect(bannerLinks(c).map((a) => a.getAttribute('href'))).toEqual(['/chien-dich/chien-dich-a']);
    expect(block(c, 'banner').querySelector('img')!.getAttribute('alt')).toBe('Chiến dịch a');
    expect(calledCampaigns()).toHaveLength(0);
  });

  it('có banner: banner là ô khuyến mãi đứng ngay trên lưới Gợi ý (mọi độ rộng, không còn cột banner của HubLayout); hero giới thiệu vẫn ở cạnh aside từ md', async () => {
    const c = await mount(<HomeView initial={{ campaigns: [campaign('a')] }} />);
    expect(hubPart(c, 'banner')).toBeNull();
    expect(hubPart(c, 'rest')!.contains(block(c, 'banner'))).toBe(true);
    expect(blockOrder(c)).toEqual(named(homeBlockOrder('new'), 'welcome', 'banner'));
    expect(blockOrder(c).indexOf('banner')).toBe(blockOrder(c).indexOf('suggest') - 1);
    expect(hubPart(c, 'aside')!.className).toContain('lg:col-span-4');
    expect(hubPart(c, 'hero')).not.toBeNull();
  });

  it('server đã hỏi và không có chiến dịch: ô khuyến mãi ẩn hẳn (không vỏ, không khung chờ); hero giới thiệu chiếm chỗ từ md, aside 4 cột', async () => {
    const c = await mount(<HomeView initial={{ campaigns: [] }} />);
    expect(hubPart(c, 'banner')).toBeNull();
    expect(hubPart(c, 'hero')).not.toBeNull();
    expect(hubPart(c, 'aside')!.className).toContain('lg:col-span-4');
    expect(block(c, 'banner')).toBeNull();
    expect(c.querySelector('[data-testid="home-banner-loading"]')).toBeNull();
    expect(calledCampaigns()).toHaveLength(0);
  });

  it('server không có dữ liệu (API lỗi lúc dựng): client tự xin /campaigns?placement=HOME_TOP không đăng nhập rồi hiện banner', async () => {
    routes['/campaigns'] = () => [campaign('b')];
    const c = await mount();
    expect(calledCampaigns()[0]).toEqual(['/campaigns', { query: { placement: 'HOME_TOP' }, anonymous: true }]);
    expect(bannerLinks(c).map((a) => a.getAttribute('href'))).toEqual(['/chien-dich/chien-dich-b']);
  });

  it('/campaigns lỗi: không banner, không báo lỗi cho thứ khách không cần, trang vẫn đủ khối khác', async () => {
    routes['/campaigns'] = () => Promise.reject(new ApiError('Máy chủ đang bận', 503));
    const c = await mount();
    expect(hubPart(c, 'banner')).toBeNull();
    expect(c.textContent).not.toContain('Máy chủ đang bận');
    expect(region(c, FEED)).not.toBeNull();
  });

  it('chiến dịch đã hết hạn lúc khách mở (trang ISR cũ): không hiện', async () => {
    const c = await mount(<HomeView initial={{ campaigns: [campaign('old', { endAt: '2020-06-01T00:00:00Z' })] }} />);
    expect(hubPart(c, 'banner')).toBeNull();
  });

  it('theo loại khách: chiến dịch NEW hiện cho khách mới, RETURNING không; khách cũ thì ngược lại', async () => {
    const list = [campaign('all'), campaign('moi', { audience: 'NEW' }), campaign('cu', { audience: 'RETURNING' })];
    const c = await mount(<HomeView initial={{ campaigns: list }} />);
    expect(bannerLinks(c).map((a) => a.getAttribute('href'))).toEqual(['/chien-dich/chien-dich-all', '/chien-dich/chien-dich-moi']);
    mounted?.unmount();
    routes['/me/purchased-items'] = () => ({ items: [{ variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: RECENT_PURCHASE }], nextCursor: null });
    const c2 = await mount(<HomeView initial={{ campaigns: list }} />);
    expect(bannerLinks(c2).map((a) => a.getAttribute('href'))).toEqual(['/chien-dich/chien-dich-all', '/chien-dich/chien-dich-cu']);
  });

  it('nhớ "lần mở này có banner" ở tubu_home_banner khi đã biết loại khách; không có banner thì ghi 0', async () => {
    await mount(<HomeView initial={{ campaigns: [campaign('a')] }} />);
    expect(localStorage.getItem(BANNER_HINT_KEY)).toBe('1');
    mounted?.unmount();
    await mount(<HomeView initial={{ campaigns: [] }} />);
    expect(localStorage.getItem(BANNER_HINT_KEY)).toBe('0');
  });

  it('chưa biết loại khách (đang khôi phục phiên, máy chưa nhớ) thì KHÔNG ghi gợi ý: ghi 0 lúc đó làm lần mở sau của khách mới nhảy trang', async () => {
    localStorage.setItem(BANNER_HINT_KEY, '1');
    mocks.phase = 'loading';
    mocks.restoring = true;
    await mount(<HomeView initial={{ campaigns: [] }} />);
    expect(localStorage.getItem(BANNER_HINT_KEY)).toBe('1');
  });

  it('khung chờ chung chỉ có MỘT khung cho mọi khối dưới dải ngữ cảnh (4 ô, không có khung banner riêng), cả khi máy nhớ lần trước có banner', async () => {
    mocks.phase = 'loading';
    mocks.restoring = true;
    mocks.get.mockImplementation(() => new Promise(() => undefined));
    const none = await mount();
    expect(none.querySelector('[data-testid="home-settling"]')!.children).toHaveLength(4);
    expect(none.querySelector('[data-testid="home-banner-loading"]')).toBeNull();
    mounted?.unmount();
    localStorage.setItem(BANNER_HINT_KEY, '1');
    const hinted = await mount();
    expect(hinted.querySelector('[data-testid="home-settling"]')!.children).toHaveLength(4);
    expect(hinted.querySelector('[data-hub-part="banner"]')).toBeNull();
    expect(hinted.querySelector('[data-testid="home-banner-loading"]')).toBeNull();
    // Thứ tự DOM của điện thoại: ô tìm → dải ngữ cảnh → khung chờ chung.
    expect(blockOrder(hinted)).toEqual(['search', 'member', 'settling']);
  });

  const settlingWithHint = async (campaigns: CampaignBanner[] | undefined) => {
    mocks.phase = 'loading';
    mocks.restoring = true;
    localStorage.setItem(BANNER_HINT_KEY, '1');
    mocks.get.mockImplementation(() => new Promise(() => undefined));
    return mount(<HomeView initial={campaigns ? { campaigns } : {}} />);
  };

  it.each([
    ['server đã có chiến dịch', [campaign('a')]],
    ['server không có chiến dịch nào', []],
    ['chỉ có chiến dịch RETURNING', [campaign('r', { audience: 'RETURNING' })]],
    ['chỉ có chiến dịch NEW', [campaign('n', { audience: 'NEW' })]],
    ['chiến dịch đã hết hạn theo giờ máy', [campaign('r', { audience: 'RETURNING', endAt: '2020-06-01T00:00:00Z' })]],
    ['server không có dữ liệu chiến dịch (API lỗi lúc dựng)', undefined],
  ])('khung chờ chung + có gợi ý banner + %s: các khối dưới (kể cả banner) chờ trong đúng một khung, không khung banner riêng, không cột banner', async (_label, campaigns) => {
    const c = await settlingWithHint(campaigns);
    expect(c.querySelector('[data-testid="home-settling"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="home-banner-loading"]')).toBeNull();
    expect(c.querySelector('[data-hub-part="banner"]')).toBeNull();
    expect(c.querySelector('[data-home-block="banner"]')).toBeNull();
  });

  it('banner chưa về mà máy nhớ lần trước có: khung giữ chỗ cùng tỉ lệ ở đúng vị trí banner; không nhớ thì không có gì', async () => {
    const pending = deferred<unknown>();
    mocks.phase = 'guest';
    routes['/campaigns'] = () => pending.promise;
    const none = await mount();
    expect(none.querySelector('[data-testid="home-banner-loading"]')).toBeNull();
    expect(hubPart(none, 'banner')).toBeNull();
    mounted?.unmount();
    localStorage.setItem(BANNER_HINT_KEY, '1');
    const c = await mount();
    const frame = c.querySelector<HTMLElement>('[data-testid="home-banner-loading"]')!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(block(c, 'banner').contains(frame)).toBe(true);
    pending.resolve([]);
  });
});

describe('HomeView — chuông và khách vãng lai', () => {
  it('chuông báo số tin chưa đọc (chỉ khi đã đăng nhập), dẫn sang trang Thông báo', async () => {
    routes['/me/summary'] = () => ({ orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: 0 }, unreadNotifications: 2, activeSubscriptions: 0 });
    const c = await mount();
    const bell = c.querySelector<HTMLAnchorElement>('a[aria-label="Thông báo, 2 chưa đọc"]')!;
    expect(bell.getAttribute('href')).toBe('/tai-khoan/thong-bao');
    expect(bell.querySelector('[aria-label="2 thông báo chưa đọc"]')?.textContent).toBe('2');
  });

  it('chuông chỉ đếm: một lời gọi /me/summary (cùng lời gọi với thanh đáy và Cá nhân), không tải danh sách tin', async () => {
    await mount();
    expect(calls('/me/summary')).toHaveLength(1);
    expect(calls('/me/notifications/unread-count')).toHaveLength(0);
    expect(calls('/orders/active-count')).toHaveLength(0);
    expect(calls('/me/notifications')).toHaveLength(0);
  });

  it('trang Thông báo chưa xong (pending) → ẩn chuông', async () => {
    routeState.pending = new Set(['/tai-khoan/thong-bao']);
    const c = await mount();
    expect(c.querySelector('a[href="/tai-khoan/thong-bao"]')).toBeNull();
  });

  it('không có tin chưa đọc → chuông không có huy hiệu', async () => {
    const c = await mount();
    expect(c.querySelector('a[aria-label="Thông báo"]')).not.toBeNull();
    expect(c.querySelector('[aria-label$="thông báo chưa đọc"]')).toBeNull();
  });

  it('khách chưa đăng nhập: không gọi for-you/notifications/purchased-items/loyalty, không có thẻ thành viên; vẫn thấy Quà khách mới (chỉ lợi ích)', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    for (const p of ['/products/for-you', '/me/summary', '/me/notifications', '/me/purchased-items', '/me/new-customer-offer', '/orders/active-count', '/me/loyalty']) {
      expect(calls(p)).toHaveLength(0);
    }
    expect(c.querySelector('a[aria-label="Thông báo"]')!.getAttribute('href')).toBe('/tai-khoan/thong-bao');
    expect(region(c, 'Thẻ thành viên')).toBeNull();
    expect(region(c, 'Quà khách mới')).not.toBeNull();
  });
});

describe('HomeView — lỗi từng khối và lỗi cấp trang', () => {
  it('danh sách thương hiệu lỗi: khối hiện thông báo + "Thử lại" ngay tại chỗ, khối khác vẫn hiện; thử lại chỉ tải lại khối đó', async () => {
    let fail = true;
    routes['/brands'] = () => {
      if (fail) throw new ApiError('Máy chủ đang bận', 503);
      return BRANDS;
    };
    const c = await mount();
    const err = region(c, FEED)!;
    expect(err.textContent).toContain('Máy chủ đang bận');
    expect(region(c, 'Bán chạy nhất')!.textContent).toContain('Hạng nhất A');
    expect(c.querySelector('[data-testid="home-page-error"]')).toBeNull();
    fail = false;
    click(err.querySelector(`button[aria-label="Thử lại ${FEED}"]`));
    await flush(8);
    expect(region(c, FEED)!.textContent).not.toContain('Máy chủ đang bận');
    expect(region(c, FEED)!.textContent).toContain('Pơ Lang số 1');
  });

  it('API sập hẳn (Bán chạy lỗi, chưa có dữ liệu) → MỘT dải lỗi cấp trang ngay dưới ô tìm, không thẻ lỗi từng khối; thử lại xong thì dải biến mất', async () => {
    let down = true;
    routes['/products'] = (q) => {
      if (down) throw new ApiError('Mất kết nối', 503);
      return q?.sort === 'best_seller_30d' ? BEST() : PAGE([card('f2', 'Chỉ nổi bật')]);
    };
    const c = await mount();
    expect(c.querySelectorAll('[data-testid="home-page-error"]')).toHaveLength(1);
    expect(c.querySelectorAll('[data-testid="home-block-error"]')).toHaveLength(0);
    expect(blockOrder(c)[1]).toBe('pageError');
    down = false;
    click(c.querySelector('[data-testid="home-page-error"] button'));
    await flush(10);
    expect(c.querySelector('[data-testid="home-page-error"]')).toBeNull();
    expect(c.textContent).toContain('Hạng nhất A');
  });

  it('kệ "Mua lại" lỗi: trang rơi về bố cục khách mới, không có thẻ lỗi cấp trang', async () => {
    routes['/me/purchased-items'] = () => Promise.reject(new ApiError('Máy chủ đang bận', 503));
    const c = await mount();
    expect(blockOrder(c)).toEqual(named(homeBlockOrder('new'), 'welcome'));
    expect(c.querySelector('[data-testid="home-page-error"]')).toBeNull();
  });
});

describe('HomeView — dữ liệu server tải sẵn', () => {
  it('có initial thì không khung chờ và không gọi lại ngay các lưới công khai', async () => {
    const c = await mount(
      <HomeView
        initial={{
          bestSellers: PAGE([card('bs1', 'Bán chạy từ server'), card('bs2', 'Hạng nhì B'), card('bs3', 'Hạng ba C')]),
          suggestSeed: '20261101',
          categories: CATEGORIES,
        }}
      />,
    );
    expect(c.textContent).toContain('Bán chạy từ server');
    // Máy chủ không tải thương hiệu (HTML đầu không vẽ khối dưới màn đầu): chỉ các nhãn tự tải món của mình.
    expect(productCalls().filter((q) => !q.brand)).toEqual([]);
    expect(calls('/categories')).toHaveLength(0);
  });
});

describe('HomeView — khung giữ chỗ của dải Story trong HTML server', () => {
  const withPhoto = (id: string, name: string) => ({ ...card(id, name), thumbnail: `https://img.test/${id}.webp` });
  const serverStories = async (bestSellers: ReturnType<typeof PAGE>) => {
    // Máy chủ dựng HTML đầu như khách vãng lai (chưa đọc phiên), và ở máy chủ trang chưa từng hydrate (các ca trước đã mount ở trình duyệt).
    mocks.phase = 'guest';
    __resetDeferForTest();
    const { renderToString } = await import('react-dom/server');
    const host = document.createElement('div');
    host.innerHTML = renderToString(
      <QueryClientProvider client={newTestClient()}>
        <HomeView initial={{ bestSellers, categories: CATEGORIES }} />
      </QueryClientProvider>,
    );
    return block(host, 'stories');
  };

  it('đủ món có ảnh cho dải: HTML chỉ có khung giữ chỗ 144px, dải dựng ở trình duyệt khi khách cuộn gần tới', async () => {
    const stories = await serverStories(PAGE([withPhoto('a', 'Món A'), withPhoto('b', 'Món B'), withPhoto('c', 'Món C')]));
    expect(stories.querySelector<HTMLElement>('[data-testid="home-defer"]')?.style.height).toBe('144px');
    expect(stories.textContent).toBe('');
  });

  it('không đủ món có ảnh (dải sẽ không hiện): không giữ chỗ, khối rỗng như trước nên trang không co lại khi dựng', async () => {
    const stories = await serverStories(PAGE([card('a', 'Món A'), card('b', 'Món B'), card('c', 'Món C')]));
    expect(stories.querySelector('[data-testid="home-defer"]')).toBeNull();
    // Chỉ còn vùng thông báo cho trình đọc màn hình (không chiếm chỗ), không có dải hay khung chờ.
    expect(stories.querySelector('section')).toBeNull();
    expect(stories.textContent).toBe('');
  });
});

// Giữ một cây React sống qua nhiều lần đổi trạng thái phiên (khung hình đầu giống HTML server, rồi mới khôi phục phiên): harness `render` không có rerender.
function mountLive(make: () => ReactElement = () => <HomeView />, opts: { strict?: boolean } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = newTestClient();
  const tree = () => {
    // Phần tử mới mỗi lần: cùng một đối tượng phần tử thì React bỏ qua lần vẽ lại và không đọc lại trạng thái phiên.
    const inner = <QueryClientProvider client={client}>{make()}</QueryClientProvider>;
    return opts.strict ? <StrictMode>{inner}</StrictMode> : inner;
  };
  act(() => root.render(tree()));
  return {
    container,
    again: () => act(() => root.render(tree())),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('HomeView — khung chờ chung khi khôi phục phiên (web: khung hình đầu là khách vãng lai)', () => {
  let live: ReturnType<typeof mountLive> | null = null;
  afterEach(() => {
    live?.unmount();
    live = null;
  });

  it('khung hình đầu là khách mới rồi mới biết có phiên chưa nhớ loại: giữ nội dung đã dựng (Bán chạy, Gợi ý), chỉ dải quà đổi thành khung giữ chỗ thẻ thành viên', async () => {
    mocks.phase = 'guest';
    live = mountLive();
    await flush(10);
    expect(blockOrder(live.container)).toEqual(named(homeBlockOrder('new'), 'welcome'));
    expect(region(live.container, 'Bán chạy nhất')!.textContent).toContain('Hạng nhất A');

    mocks.phase = 'loading';
    mocks.restoring = true;
    live.again();
    await flush(10);
    expect(blockOrder(live.container)).toEqual(named(homeKeptOrder('unknown'), 'member'));
    expect(blockOrder(live.container)).not.toContain('settling');
    expect(region(live.container, 'Bán chạy nhất')!.textContent).toContain('Hạng nhất A');
    expect(region(live.container, FEED)).not.toBeNull();
    expect(region(live.container, 'Quà khách mới')).toBeNull();
    expect(live.container.querySelector('[data-testid="member-card-loading"]')).not.toBeNull();
  });

  it('phiên khôi phục xong là khách cũ: giữ thứ tự đã vẽ, Mua lại chen ngay trên lưới Gợi ý (không đẩy khối trong màn đầu), không qua khung chờ chung', async () => {
    mocks.phase = 'guest';
    live = mountLive();
    await flush(10);
    mocks.phase = 'loading';
    mocks.restoring = true;
    live.again();
    await flush(10);
    routes['/me/purchased-items'] = () => ({ items: [{ variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: RECENT_PURCHASE }], nextCursor: null });
    mocks.phase = 'authenticated';
    mocks.restoring = false;
    live.again();
    await flush(12);
    expect(blockOrder(live.container)).toEqual(named(homeKeptOrder('returning'), 'member'));
    const order = blockOrder(live.container);
    expect(order.indexOf('purchased')).toBe(order.indexOf('suggest') - 1);
    expect(region(live.container, 'Bán chạy nhất')).not.toBeNull();
    expect(region(live.container, 'Mua lại')).not.toBeNull();
  });

  it('khung hình đầu đã chưa biết loại khách (máy mới có cờ phiên): vẫn là một khung chờ chung như cũ, không dựng khối khách mới', async () => {
    mocks.phase = 'loading';
    mocks.restoring = true;
    live = mountLive();
    await flush(10);
    expect(blockOrder(live.container)).toEqual(named(homeRenderOrder('unknown', true), 'member'));
    expect(region(live.container, 'Bán chạy nhất')).toBeNull();
  });

  it('phiên lỗi (mất mạng, API tạm lỗi): nhả ngay khung chờ, hiện bố cục khách mới mặc định dù Danh mục chưa về', async () => {
    routes['/categories'] = () => new Promise(() => undefined);
    mocks.phase = 'guest';
    live = mountLive();
    await flush(10);
    mocks.phase = 'loading';
    mocks.restoring = true;
    live.again();
    await flush(10);
    expect(blockOrder(live.container)).toEqual(named(homeKeptOrder('unknown'), 'member'));

    mocks.phase = 'unavailable';
    mocks.restoring = false;
    live.again();
    await flush(10);
    expect(blockOrder(live.container)).toEqual(named(homeBlockOrder('new'), 'welcome'));
    expect(region(live.container, 'Bán chạy nhất')!.textContent).toContain('Hạng nhất A');
    expect(live.container.querySelector('[data-testid="member-card-loading"]')).toBeNull();
  });

  it('đang giữ khung chờ chung từ khung hình đầu (máy có cờ phiên, chưa nhớ loại) rồi phiên lỗi: nhả ngay dù dữ liệu chưa về, không chờ 4,5 giây', async () => {
    routes['/categories'] = () => new Promise(() => undefined);
    mocks.phase = 'loading';
    mocks.restoring = true;
    live = mountLive();
    await flush(10);
    expect(blockOrder(live.container)).toEqual(named(homeRenderOrder('unknown', true), 'member'));

    mocks.phase = 'unavailable';
    mocks.restoring = false;
    live.again();
    await flush(10);
    expect(blockOrder(live.container)).toEqual(named(homeBlockOrder('new'), 'welcome'));
  });

  it('mở lần đầu mà phiên đã lỗi và máy chưa nhớ loại khách: bố cục khách mới ngay, không chờ khung chờ chung', async () => {
    routes['/categories'] = () => new Promise(() => undefined);
    mocks.phase = 'unavailable';
    mocks.restoring = false;
    live = mountLive();
    await flush(10);
    expect(blockOrder(live.container)).toEqual(named(homeBlockOrder('new'), 'welcome'));
    expect(blockOrder(live.container)).not.toContain('settling');
  });
});

describe('HomeView — khung chờ chung ở cấp trang: truy vấn quyết định lỗi, hẹn giờ 4,5 giây', () => {
  let live: ReturnType<typeof mountLive> | null = null;
  afterEach(() => {
    live?.unmount();
    live = null;
    vi.useRealTimers();
  });

  it('Giờ vàng (truy vấn quyết định) lỗi lúc đang giữ khung chờ: thả khung chờ; ô khuyến mãi tự ẩn (không có gì để vẽ), không thẻ lỗi cho một khối khách không cần', async () => {
    const purchased = deferred<unknown>();
    const flash = deferred<unknown>();
    routes['/me/purchased-items'] = () => purchased.promise;
    routes['/flash-sales/active'] = () => flash.promise;
    live = mountLive();
    await flush(10);
    expect(blockOrder(live.container)).toEqual(named(homeRenderOrder('unknown', true), 'member'));

    purchased.resolve({ items: [{ variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: RECENT_PURCHASE }], nextCursor: null });
    await flush(10);
    expect(blockOrder(live.container)).toEqual(named(homeRenderOrder('returning', true), 'member'));

    flash.reject(new ApiError('Máy chủ đang bận', 503));
    await flush(10);
    expect(blockOrder(live.container)).toEqual(named(homeBlockOrder('returning'), 'member'));
    expect(live.container.querySelector('[data-testid="home-block-error"]')).toBeNull();
    expect(region(live.container, 'Bán chạy nhất')).not.toBeNull();
    expect(region(live.container, 'Mua lại')).not.toBeNull();
  });

  it('hẹn giờ 4,5 giây (StrictMode, giờ giả): mạng chậm, chưa biết loại khách và dữ liệu chưa về thì nhả đúng lúc, không sớm hơn', async () => {
    vi.useFakeTimers();
    routes['/me/purchased-items'] = () => new Promise(() => undefined);
    routes['/flash-sales/active'] = () => new Promise(() => undefined);
    live = mountLive(() => <HomeView />, { strict: true });
    const tick = async (ms: number) => {
      await act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
      for (let i = 0; i < 4; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    };
    await tick(0);
    expect(blockOrder(live.container)).toEqual(named(homeRenderOrder('unknown', true), 'member'));
    await tick(HOME_SETTLE_MAX_MS - 100);
    expect(blockOrder(live.container)).toEqual(named(homeRenderOrder('unknown', true), 'member'));
    await tick(200);
    expect(blockOrder(live.container)).toEqual(named(homeBlockOrder('unknown'), 'member'));
  });

  it('khung hình đầu là khách mới, mạng chậm quá 4,5 giây mà vẫn chưa biết loại khách: nội dung đã dựng (Bán chạy, Gợi ý) không biến mất rồi hiện lại', async () => {
    vi.useFakeTimers();
    mocks.phase = 'guest';
    live = mountLive(() => <HomeView />, { strict: true });
    const tick = async (ms: number) => {
      await act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
      for (let i = 0; i < 4; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    };
    await tick(0);
    expect(blockOrder(live.container)).toEqual(named(homeBlockOrder('new'), 'welcome'));
    expect(region(live.container, 'Bán chạy nhất')).not.toBeNull();

    routes['/me/purchased-items'] = () => new Promise(() => undefined);
    mocks.phase = 'loading';
    mocks.restoring = true;
    live.again();
    await tick(HOME_SETTLE_MAX_MS - 100);
    expect(blockOrder(live.container)).toEqual(named(homeKeptOrder('unknown'), 'member'));

    // Hẹn giờ nhả khung chờ: loại khách vẫn "chưa biết" nhưng khối đã dựng ở lại.
    await tick(200);
    expect(blockOrder(live.container)).toEqual(named(homeKeptOrder('unknown'), 'member'));
    expect(region(live.container, 'Bán chạy nhất')!.textContent).toContain('Hạng nhất A');
    expect(region(live.container, FEED)).not.toBeNull();

    routes['/me/purchased-items'] = () => ({ items: [], nextCursor: null });
    mocks.phase = 'authenticated';
    mocks.restoring = false;
    live.again();
    await tick(50);
    expect(blockOrder(live.container)).toEqual(named(homeBlockOrder('new'), 'welcome'));
    expect(region(live.container, 'Bán chạy nhất')!.textContent).toContain('Hạng nhất A');
  });
});

describe('HomeView — Combo tiết kiệm (P15)', () => {
  const comboItem = (id: string) => ({ productId: id, variationId: `v-${id}`, maxQty: 1, addonPrice: null, inStock: true, product: { ...card(id, `Món ${id}`), repVariationId: `v-${id}` } });
  const combo = (id: string, a: string, b: string) => ({
    id, kind: 'BUNDLE_PCT', title: `Combo ${id}`, pct: 10, endAt: new Date(Date.now() + 86_400_000).toISOString(), anchorProductId: null, items: [comboItem(a), comboItem(b)],
  });

  it('có từ 2 combo: kệ đứng sau Bán chạy nhất, đúng thứ tự khối, hỏi /bundles/combos?limit=4', async () => {
    routes['/bundles/combos'] = () => [combo('c1', 'm1', 'm2'), combo('c2', 'm3', 'm4')];
    const c = await mount();
    expect(blockOrder(c)).toEqual(named(homeBlockOrder('new'), 'welcome', 'combos'));
    expect(region(c, 'Combo tiết kiệm')).not.toBeNull();
    expect(block(c, 'combos').contains(region(c, 'Combo tiết kiệm'))).toBe(true);
    expect(block(c, 'bestSellers').compareDocumentPosition(block(c, 'combos')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(calls('/bundles/combos')[0]![1]).toEqual({ query: { limit: 4 }, anonymous: true });
  });

  it('chỉ 1 combo hoặc API lỗi: ẩn hẳn kệ, trang vẫn đủ khối khác', async () => {
    routes['/bundles/combos'] = () => [combo('c1', 'm1', 'm2')];
    const one = await mount();
    expect(region(one, 'Combo tiết kiệm')).toBeNull();
    expect(region(one, 'Bán chạy nhất')).not.toBeNull();
    mounted!.unmount();
    routes['/bundles/combos'] = () => {
      throw new Error('offline');
    };
    const failed = await mount();
    expect(region(failed, 'Combo tiết kiệm')).toBeNull();
    expect(region(failed, 'Bán chạy nhất')).not.toBeNull();
  });
});

describe('HomeView — ảnh ưu tiên: Bán chạy nhất luôn là khối ảnh đầu tiên (ô khuyến mãi và Mua lại nằm dưới nó)', () => {
  const thumb = (id: string) => `https://cdn.example/${id}.jpg`;
  const LEAD = [['eager', 'high'], ['eager', 'high'], ['lazy', null], ['lazy', null]];
  const shelfImages = (c: HTMLElement) =>
    Array.from(region(c, 'Bán chạy nhất')!.querySelectorAll('[data-testid="best-seller-rail"] img')).map((i) => [i.getAttribute('loading'), i.getAttribute('fetchpriority')]);
  const flashItem = (slug: string) => ({
    itemId: `i-${slug}`, variationId: `v-${slug}`, productSlug: slug, productName: `Giờ vàng ${slug}`, thumbnail: thumb(slug),
    retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 1, endAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const bought = { variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: RECENT_PURCHASE };
  let live: ReturnType<typeof mountLive> | null = null;

  beforeEach(() => {
    const others = routes['/products']!;
    const items = ['bs1', 'bs2', 'bs3', 'bs4'].map((id, i) => ({ ...card(id, `Hạng ${i + 1}`), thumbnail: thumb(id) }));
    const best = { data: items, meta: { page: 1, limit: 6, total: items.length } };
    routes['/products'] = (q) => (q?.sort === 'best_seller_30d' ? best : others(q));
  });
  afterEach(() => {
    live?.unmount();
    live = null;
  });

  it('không banner, không Giờ vàng (máy chủ đã hỏi): hai thẻ đầu eager + fetchpriority=high, thẻ sau lazy; cả trang chỉ hai ảnh ưu tiên', async () => {
    const c = await mount(<HomeView initial={{ campaigns: [], flash: [] }} />);
    expect(blockOrder(c)).toEqual(named(homeBlockOrder('new'), 'welcome'));
    expect(shelfImages(c)).toEqual(LEAD);
    expect(c.querySelectorAll('img[fetchpriority="high"]')).toHaveLength(2);
  });

  it('có banner chiến dịch: banner đứng DƯỚI kệ nên kệ vẫn giữ ảnh ưu tiên', async () => {
    const c = await mount(<HomeView initial={{ campaigns: [campaign('a')], flash: [] }} />);
    expect(shelfImages(c)).toEqual(LEAD);
    expect(block(c, 'bestSellers').compareDocumentPosition(block(c, 'banner')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Khách vãng lai như HTML máy chủ: khách đăng nhập chưa rõ loại thì khung chờ chung che mọi khối trong lúc Giờ vàng hay banner còn tải.
  it('máy nhớ lần trước có banner mà banner chưa về (khung giữ chỗ dưới kệ): Bán chạy nhất vẫn giữ ảnh ưu tiên', async () => {
    mocks.phase = 'guest';
    localStorage.setItem(BANNER_HINT_KEY, '1');
    routes['/campaigns'] = () => new Promise(() => undefined);
    const c = await mount(<HomeView initial={{ flash: [] }} />);
    expect(block(c, 'banner').childElementCount).toBeGreaterThan(0);
    expect(shelfImages(c)).toEqual(LEAD);
  });

  it('có Giờ vàng: Giờ vàng đứng dưới kệ nên tải lười, kệ Bán chạy nhất giữ ảnh ưu tiên', async () => {
    const flash = ['fa', 'fb', 'fc'].map(flashItem);
    routes['/flash-sales/active'] = () => flash;
    const c = await mount(<HomeView initial={{ campaigns: [], flash }} />);
    expect(block(c, 'flash').querySelectorAll('img[fetchpriority="high"]')).toHaveLength(0);
    expect(shelfImages(c)).toEqual(LEAD);
    expect(c.querySelectorAll('img[fetchpriority="high"]')).toHaveLength(2);
  });

  it('máy chủ hụt Giờ vàng và client còn đang tải: kệ Bán chạy nhất vẫn giữ ảnh ưu tiên (Giờ vàng, nếu có, chỉ chen dưới nó)', async () => {
    mocks.phase = 'guest';
    routes['/flash-sales/active'] = () => new Promise(() => undefined);
    const c = await mount(<HomeView initial={{ campaigns: [] }} />);
    expect(shelfImages(c)).toEqual(LEAD);
  });

  it('khách cũ: Mua lại đứng SAU Bán chạy nhất nên kệ vẫn giữ ảnh ưu tiên', async () => {
    routes['/me/purchased-items'] = () => ({ items: [bought], nextCursor: null });
    const c = await mount(<HomeView initial={{ campaigns: [], flash: [] }} />);
    expect(blockOrder(c)).toEqual(named(homeBlockOrder('returning'), 'member'));
    expect(blockOrder(c).indexOf('purchased')).toBe(blockOrder(c).indexOf('bestSellers') + 1);
    expect(shelfImages(c)).toEqual(LEAD);
  });

  it('HTML đầu là khách mới rồi biết là khách cũ: Mua lại chen sau lưới đầu nên kệ vẫn giữ ảnh ưu tiên', async () => {
    mocks.phase = 'guest';
    live = mountLive(() => <HomeView initial={{ campaigns: [], flash: [] }} />);
    await flush(10);
    expect(shelfImages(live.container)).toEqual(LEAD);
    mocks.phase = 'loading';
    mocks.restoring = true;
    live.again();
    await flush(10);
    routes['/me/purchased-items'] = () => ({ items: [bought], nextCursor: null });
    mocks.phase = 'authenticated';
    mocks.restoring = false;
    live.again();
    await flush(12);
    expect(blockOrder(live.container)).toEqual(named(homeKeptOrder('returning'), 'member'));
    expect(shelfImages(live.container)).toEqual(LEAD);
  });
});
