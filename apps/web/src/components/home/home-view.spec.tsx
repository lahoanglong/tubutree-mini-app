// @vitest-environment jsdom
import { StrictMode, act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { newTestClient } from '@/test-utils/render-hook';
import { ApiError } from '@/lib/client-api';

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
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
const routeState = vi.hoisted(() => ({ pending: new Set<string>() }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => !routeState.pending.has(p) }));

import HomeView from './home-view';
import { homeBlockOrder } from './home-blocks';
import { HOME_SETTLE_MAX_MS, homeKeptOrder, homeRenderOrder } from '@tubutree/app-core/home-layout';
import { resetFlashSales } from '@/lib/use-flash-sales';
import { HOME_KIND_KEY } from './use-home-customer-kind';
import { BANNER_HINT_KEY } from '@tubutree/app-core/home-layout';
import type { CampaignBanner } from '@tubutree/app-core/api/campaign';

const CONFIG = {
  freeshipThreshold: 350_000, subscribeDiscountPct: 0.17, affiliateWalletMultiplier: 1, cashbackHoldDays: 30,
  loyalty: { vndPerPoint: 20_000, vndPerPointRedeem: 1_000 },
};
const card = (id: string, name: string) => ({ id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 50000, salePrice: null, isFeatured: true, inStock: true });
const PAGE = (items: ReturnType<typeof card>[]) => ({ data: items, meta: { page: 1, limit: 6, total: items.length } });
/** Ba món bán chạy (kệ Bán chạy nhất chỉ hiện từ 3 món), khác slug với Giờ vàng và lưới gợi ý. */
const BEST = () => PAGE([card('bs1', 'Hạng nhất A'), card('bs2', 'Hạng nhì B'), card('bs3', 'Hạng ba C')]);
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

beforeEach(() => {
  localStorage.clear();
  resetFlashSales();
  routeState.pending = new Set();
  mocks.phase = 'authenticated';
  mocks.restoring = false;
  mocks.user = { id: 'u1', fullName: 'Lan', pointsBalance: 0 };
  mocks.push.mockReset();
  routes = {
    '/products': (q) => (q?.sort === 'best_seller_30d' ? BEST() : PAGE([card('f1', 'Trùng gợi ý'), card('f2', 'Chỉ nổi bật')])),
    '/products/for-you': () => [card('f1', 'Trùng gợi ý')],
    '/brands': () => [],
    '/categories': () => CATEGORIES,
    '/me/notifications/unread-count': () => ({ count: 0 }),
    '/me/purchased-items': () => ({ items: [], nextCursor: null }),
    '/config/public': () => CONFIG,
    '/me/new-customer-offer': () => ({ isNewCustomer: true, welcomeVoucher: null }),
    '/orders/active-count': () => ({ count: 0 }),
    '/me/subscriptions': () => [],
    '/me/loyalty': () => ({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 }),
    '/me/coupons': () => [],
    '/me/daily-check-in': () => ({ checkedInToday: true, streakDays: 1, currentCycleDay: 1, rewards: [] }),
    '/feed': () => ({ posts: [] }),
    '/flash-sales/active': () => [],
    '/flash-sales/upcoming': () => [],
    '/campaigns': () => [],
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
  it('khách mới: Quà khách mới thay thẻ thành viên, có kệ Bán chạy, không có Mua lại; thứ tự đúng homeBlockOrder("new")', async () => {
    const c = await mount();
    expect(blockOrder(c)).toEqual([...homeBlockOrder('new')]);
    expect(block(c, 'member')).toBeNull();
    expect(region(c, 'Bán chạy nhất')).not.toBeNull();
    expect(calls('/me/purchased-items')[0]![1]).toEqual({ query: { limit: 10 } });
  });

  it('khách cũ: thứ tự "returning" sau khi purchased-items có hàng; thẻ thành viên có mặt, Quà khách mới không', async () => {
    routes['/me/purchased-items'] = () => ({ items: [{ variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: '2026-01-01' }], nextCursor: null });
    const c = await mount();
    expect(blockOrder(c)).toEqual([...homeBlockOrder('returning')]);
    expect(region(c, 'Thẻ thành viên')).not.toBeNull();
    expect(region(c, 'Quà khách mới')).toBeNull();
    expect(region(c, 'Mua lại')).not.toBeNull();
  });

  it('khách cũ đã được nhớ: ngay từ khung hình đầu đã theo thứ tự returning, dù purchased-items còn tải', async () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    routes['/me/purchased-items'] = () => new Promise(() => undefined);
    const c = await mount();
    expect(blockOrder(c)).toEqual([...homeBlockOrder('returning')]);
    expect(calls('/me/new-customer-offer')).toHaveLength(0);
  });

  it('đang khôi phục phiên + đã nhớ khách cũ: bố cục khách cũ ngay (khung chờ thẻ thành viên và kệ Mua lại), Bán chạy nhất vẫn có (kệ công khai), không gọi API khách', async () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    mocks.phase = 'loading';
    mocks.restoring = true;
    const c = await mount();
    expect(blockOrder(c)).toEqual([...homeBlockOrder('returning')]);
    expect(c.querySelector('[data-testid="member-card-loading"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="purchased-rail-loading"]')).not.toBeNull();
    expect(region(c, 'Bán chạy nhất')).not.toBeNull();
    expect(calls('/me/purchased-items')).toHaveLength(0);
  });

  it('đang khôi phục phiên, chưa nhớ gì: chưa biết (khung chờ trung tính), không dựng bố cục khách mới', async () => {
    mocks.phase = 'loading';
    mocks.restoring = true;
    const c = await mount();
    expect(blockOrder(c)).toEqual([...homeRenderOrder('unknown', true)]);
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
  it('"Bán chạy nhất" xin sort=best_seller_30d, 12 món, có hạng #1..#3, cho cả khách cũ; lưới gợi ý xin trang đầu kèm seed và không gọi newest/nổi bật riêng', async () => {
    const c = await mount();
    const calledSorts = productCalls().map((q) => q.sort);
    expect(calledSorts).toEqual(expect.arrayContaining(['best_seller_30d', undefined]));
    expect(calledSorts).not.toContain('newest');
    const best = productCalls().find((q) => q.sort === 'best_seller_30d')!;
    expect(best.limit).toBe(12);
    const shelf = region(c, 'Bán chạy nhất')!;
    expect(shelf.textContent).toContain('Hạng nhất A');
    for (const rank of ['#1', '#2', '#3']) expect(shelf.textContent).toContain(rank);
    const suggest = productCalls().find((q) => !q.sort)!;
    expect(suggest.seed).toMatch(/^\d{8}$/);
  });

  it('chỉ MỘT lưới gợi ý: "Gợi ý hôm nay" có chip Tất cả + danh mục; gợi ý cá nhân đứng đầu, không trùng sản phẩm và không lặp món đã ở kệ trên', async () => {
    const c = await mount();
    const feed = region(c, 'Gợi ý hôm nay')!;
    expect(feed).not.toBeNull();
    expect(feed.querySelectorAll('ul[aria-hidden="true"]')).toHaveLength(0);
    const chips = Array.from(feed.querySelectorAll('button')).map((b) => b.textContent);
    expect(chips).toEqual(expect.arrayContaining(['Tất cả', 'Dầu gội']));
    const names = Array.from(feed.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(names.filter((t) => t.includes('Trùng gợi ý'))).toHaveLength(1);
    expect(names[0]).toContain('Trùng gợi ý');
    expect(names.some((t) => t.includes('Hạng nhất A'))).toBe(false);
  });

  it('đổi chip sang một danh mục tải lưới theo category kèm seed', async () => {
    const c = await mount();
    click(byText(region(c, 'Gợi ý hôm nay')!, 'button', 'Dầu gội'));
    await flush(8);
    expect(productCalls().some((q) => q.category === 'c-goi' && typeof q.seed === 'string')).toBe(true);
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
    const search = c.querySelector('a[aria-label="Bạn đang tìm gì hôm nay?"]');
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

  it('thẻ thành viên (hoặc quà khách mới) và Việc cần làm nằm trong aside của lưới 12 cột; ô tìm ở NGOÀI lưới (phải là con trực tiếp của trang để dính); phần còn lại ở children', async () => {
    const c = await mount();
    const hub = c.querySelector<HTMLElement>('[data-testid="hub-layout"]')!;
    expect(hub).not.toBeNull();
    expect(hub.contains(block(c, 'search'))).toBe(false);
    const aside = hubPart(c, 'aside');
    expect(Array.from(aside.querySelectorAll('[data-home-block]')).map((el) => (el as HTMLElement).dataset.homeBlock)).toEqual(['welcome', 'todo']);
    const rest = hubPart(c, 'rest');
    expect(rest.contains(block(c, 'shortcuts'))).toBe(true);
    expect(rest.contains(block(c, 'suggest'))).toBe(true);
    expect(rest.contains(block(c, 'welcome'))).toBe(false);
  });

  it('chưa có banner (chờ P11): không vẽ khung banner, aside chiếm 12 cột; khối banner rỗng vẫn đứng đúng thứ tự', async () => {
    const c = await mount();
    expect(c.querySelector('[data-hub-part="banner"]')).toBeNull();
    expect(hubPart(c, 'aside').className).toContain('lg:col-span-12');
    expect(blockOrder(c)).toContain('banner');
  });

  it('lối tắt 4 ô chỉ ở điện thoại: từ lg ẩn (thanh đầu website đã đủ lối vào)', async () => {
    const c = await mount();
    expect(block(c, 'shortcuts').querySelector('section')?.className).toContain('lg:hidden');
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

  it('có banner: HubLayout vẽ cột banner (lg: 8 cột) cạnh aside (4 cột); khối banner đứng đúng thứ tự homeBlockOrder', async () => {
    const c = await mount(<HomeView initial={{ campaigns: [campaign('a')] }} />);
    expect(hubPart(c, 'banner')!.className).toContain('lg:col-span-8');
    expect(hubPart(c, 'aside')!.className).toContain('lg:col-span-4');
    expect(hubPart(c, 'banner')!.contains(block(c, 'banner'))).toBe(true);
    expect(blockOrder(c)).toEqual([...homeBlockOrder('new')]);
  });

  it('server đã hỏi và không có chiến dịch: ẩn hẳn, không khung banner, aside chiếm 12 cột, không khung chờ', async () => {
    const c = await mount(<HomeView initial={{ campaigns: [] }} />);
    expect(hubPart(c, 'banner')).toBeNull();
    expect(hubPart(c, 'aside')!.className).toContain('lg:col-span-12');
    expect(block(c, 'banner').childElementCount).toBe(0);
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
    expect(region(c, 'Gợi ý hôm nay')).not.toBeNull();
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
    routes['/me/purchased-items'] = () => ({ items: [{ variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: '2026-01-01' }], nextCursor: null });
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

  it('khung chờ chung không tự vẽ khung banner: không có gợi ý thì không giữ chỗ; có gợi ý thì khung giữ chỗ nằm ở cột banner của HubLayout, chỉ một khung', async () => {
    mocks.phase = 'loading';
    mocks.restoring = true;
    mocks.get.mockImplementation(() => new Promise(() => undefined));
    const none = await mount();
    expect(none.querySelector('[data-testid="home-settling"]')!.children).toHaveLength(4);
    expect(none.querySelector('[data-hub-part="banner"]')).toBeNull();
    expect(none.querySelector('[data-testid="home-banner-loading"]')).toBeNull();
    mounted?.unmount();
    localStorage.setItem(BANNER_HINT_KEY, '1');
    const hinted = await mount();
    expect(hinted.querySelector('[data-testid="home-settling"]')!.children).toHaveLength(4);
    const slot = hinted.querySelector<HTMLElement>('[data-hub-part="banner"]')!;
    expect(slot.className).toContain('lg:col-span-8');
    expect(slot.querySelectorAll('[data-testid="home-banner-loading"]')).toHaveLength(1);
    expect(hinted.querySelectorAll('[data-testid="home-banner-loading"]')).toHaveLength(1);
    // Thứ tự DOM của điện thoại: thẻ thành viên → banner → khung chờ chung.
    const order = Array.from(hinted.querySelectorAll<HTMLElement>('[data-home-block]')).map((el) => el.dataset.homeBlock);
    expect(order).toEqual(['search', 'member', 'banner', 'settling']);
  });

  it('khung chờ chung + server đã có chiến dịch: banner thật đứng ở cột banner ngay trong lúc chờ (không đợi hết chờ mới chen vào hàng đầu)', async () => {
    mocks.phase = 'loading';
    mocks.restoring = true;
    mocks.get.mockImplementation(() => new Promise(() => undefined));
    const c = await mount(<HomeView initial={{ campaigns: [campaign('a')] }} />);
    expect(c.querySelector('[data-testid="home-settling"]')).not.toBeNull();
    expect(c.querySelector('[data-hub-part="banner"]')!.querySelector('a[href="/chien-dich/chien-dich-a"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="home-banner-loading"]')).toBeNull();
  });

  const settlingWithHint = async (campaigns: CampaignBanner[] | undefined) => {
    mocks.phase = 'loading';
    mocks.restoring = true;
    localStorage.setItem(BANNER_HINT_KEY, '1');
    mocks.get.mockImplementation(() => new Promise(() => undefined));
    return mount(<HomeView initial={campaigns ? { campaigns } : {}} />);
  };

  it('khung chờ chung + có gợi ý banner + server đã hỏi và không có chiến dịch nào (mọi đối tượng): không giữ chỗ, biết loại khách cũng không hiện thêm banner', async () => {
    const c = await settlingWithHint([]);
    expect(c.querySelector('[data-testid="home-settling"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="home-banner-loading"]')).toBeNull();
    expect(c.querySelector('[data-hub-part="banner"]')).toBeNull();
  });

  it('khung chờ chung + có gợi ý + server chỉ có chiến dịch RETURNING: giữ chỗ (khách cũ sẽ thấy khi biết loại)', async () => {
    const c = await settlingWithHint([campaign('r', { audience: 'RETURNING' })]);
    expect(c.querySelector('[data-testid="home-settling"]')).not.toBeNull();
    expect(c.querySelector('[data-hub-part="banner"]')!.querySelectorAll('[data-testid="home-banner-loading"]')).toHaveLength(1);
  });

  it('khung chờ chung + có gợi ý + server chỉ có chiến dịch NEW: giữ chỗ (khách mới sẽ thấy khi biết loại)', async () => {
    const c = await settlingWithHint([campaign('n', { audience: 'NEW' })]);
    expect(c.querySelector('[data-hub-part="banner"]')!.querySelectorAll('[data-testid="home-banner-loading"]')).toHaveLength(1);
  });

  it('khung chờ chung + có gợi ý + chiến dịch riêng đã hết hạn theo giờ máy: không giữ chỗ', async () => {
    const c = await settlingWithHint([campaign('r', { audience: 'RETURNING', endAt: '2020-06-01T00:00:00Z' })]);
    expect(c.querySelector('[data-testid="home-banner-loading"]')).toBeNull();
  });

  it('khung chờ chung + có gợi ý + server không có dữ liệu chiến dịch (API lỗi lúc dựng): vẫn giữ chỗ trong lúc chờ client hỏi', async () => {
    const c = await settlingWithHint(undefined);
    expect(c.querySelector('[data-hub-part="banner"]')!.querySelectorAll('[data-testid="home-banner-loading"]')).toHaveLength(1);
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
    routes['/me/notifications/unread-count'] = () => ({ count: 2 });
    const c = await mount();
    const bell = c.querySelector<HTMLAnchorElement>('a[aria-label="Thông báo, 2 chưa đọc"]')!;
    expect(bell.getAttribute('href')).toBe('/tai-khoan/thong-bao');
    expect(bell.querySelector('[aria-label="2 thông báo chưa đọc"]')?.textContent).toBe('2');
  });

  it('chuông chỉ đếm: một lời gọi unread-count, không tải danh sách tin', async () => {
    await mount();
    expect(calls('/me/notifications/unread-count')).toHaveLength(1);
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
    for (const p of ['/products/for-you', '/me/notifications/unread-count', '/me/notifications', '/me/purchased-items', '/me/new-customer-offer', '/orders/active-count', '/me/loyalty']) {
      expect(calls(p)).toHaveLength(0);
    }
    expect(c.querySelector('a[aria-label="Thông báo"]')!.getAttribute('href')).toBe('/tai-khoan/thong-bao');
    expect(region(c, 'Thẻ thành viên')).toBeNull();
    expect(region(c, 'Quà khách mới')).not.toBeNull();
  });
});

describe('HomeView — lỗi từng khối và lỗi cấp trang', () => {
  it('lưới gợi ý lỗi hiện thông báo + "Thử lại" ngay tại chỗ, khối khác vẫn hiện; thử lại chỉ tải lại lưới đó', async () => {
    let fail = true;
    routes['/products'] = (q) => {
      if (!q?.sort && fail) throw new ApiError('Máy chủ đang bận', 503);
      return q?.sort === 'best_seller_30d' ? BEST() : PAGE([card('f2', 'Chỉ nổi bật')]);
    };
    routes['/products/for-you'] = () => [];
    const c = await mount();
    const err = region(c, 'Gợi ý hôm nay')!;
    expect(err.textContent).toContain('Máy chủ đang bận');
    expect(region(c, 'Bán chạy nhất')!.textContent).toContain('Hạng nhất A');
    expect(c.querySelector('[data-testid="home-page-error"]')).toBeNull();
    fail = false;
    click(err.querySelector('button[aria-label="Thử lại Gợi ý hôm nay"]'));
    await flush(8);
    expect(region(c, 'Gợi ý hôm nay')!.textContent).not.toContain('Máy chủ đang bận');
    expect(region(c, 'Gợi ý hôm nay')!.textContent).toContain('Chỉ nổi bật');
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
    expect(blockOrder(c)).toEqual([...homeBlockOrder('new')]);
    expect(c.querySelector('[data-testid="home-page-error"]')).toBeNull();
  });
});

describe('HomeView — dữ liệu server tải sẵn', () => {
  it('có initial thì không khung chờ và không gọi lại ngay các lưới công khai', async () => {
    const c = await mount(
      <HomeView
        initial={{
          bestSellers: PAGE([card('bs1', 'Bán chạy từ server'), card('bs2', 'Hạng nhì B'), card('bs3', 'Hạng ba C')]),
          suggest: PAGE([card('f2', 'Gợi ý từ server')]),
          suggestSeed: '20261101',
          categories: CATEGORIES,
        }}
      />,
    );
    expect(c.textContent).toContain('Bán chạy từ server');
    expect(c.textContent).toContain('Gợi ý từ server');
    expect(productCalls()).toEqual([]);
    expect(calls('/categories')).toHaveLength(0);
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
    expect(blockOrder(live.container)).toEqual([...homeBlockOrder('new')]);
    expect(region(live.container, 'Bán chạy nhất')!.textContent).toContain('Hạng nhất A');

    mocks.phase = 'loading';
    mocks.restoring = true;
    live.again();
    await flush(10);
    expect(blockOrder(live.container)).toEqual([...homeKeptOrder('unknown')]);
    expect(blockOrder(live.container)).not.toContain('settling');
    expect(region(live.container, 'Bán chạy nhất')!.textContent).toContain('Hạng nhất A');
    expect(region(live.container, 'Gợi ý hôm nay')).not.toBeNull();
    expect(region(live.container, 'Quà khách mới')).toBeNull();
    expect(live.container.querySelector('[data-testid="member-card-loading"]')).not.toBeNull();
  });

  it('phiên khôi phục xong là khách cũ: giữ thứ tự đã vẽ, Mua lại chen sau Bán chạy nhất (không đẩy khối trong màn đầu), không qua khung chờ chung', async () => {
    mocks.phase = 'guest';
    live = mountLive();
    await flush(10);
    mocks.phase = 'loading';
    mocks.restoring = true;
    live.again();
    await flush(10);
    routes['/me/purchased-items'] = () => ({ items: [{ variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: '2026-01-01' }], nextCursor: null });
    mocks.phase = 'authenticated';
    mocks.restoring = false;
    live.again();
    await flush(12);
    expect(blockOrder(live.container)).toEqual([...homeKeptOrder('returning')]);
    const order = blockOrder(live.container);
    expect(order.indexOf('purchased')).toBe(order.indexOf('bestSellers') + 1);
    expect(region(live.container, 'Bán chạy nhất')).not.toBeNull();
    expect(region(live.container, 'Mua lại')).not.toBeNull();
  });

  it('khung hình đầu đã chưa biết loại khách (máy mới có cờ phiên): vẫn là một khung chờ chung như cũ, không dựng khối khách mới', async () => {
    mocks.phase = 'loading';
    mocks.restoring = true;
    live = mountLive();
    await flush(10);
    expect(blockOrder(live.container)).toEqual([...homeRenderOrder('unknown', true)]);
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
    expect(blockOrder(live.container)).toEqual([...homeKeptOrder('unknown')]);

    mocks.phase = 'unavailable';
    mocks.restoring = false;
    live.again();
    await flush(10);
    expect(blockOrder(live.container)).toEqual([...homeBlockOrder('new')]);
    expect(region(live.container, 'Bán chạy nhất')!.textContent).toContain('Hạng nhất A');
    expect(live.container.querySelector('[data-testid="member-card-loading"]')).toBeNull();
  });

  it('đang giữ khung chờ chung từ khung hình đầu (máy có cờ phiên, chưa nhớ loại) rồi phiên lỗi: nhả ngay dù dữ liệu chưa về, không chờ 4,5 giây', async () => {
    routes['/categories'] = () => new Promise(() => undefined);
    mocks.phase = 'loading';
    mocks.restoring = true;
    live = mountLive();
    await flush(10);
    expect(blockOrder(live.container)).toEqual([...homeRenderOrder('unknown', true)]);

    mocks.phase = 'unavailable';
    mocks.restoring = false;
    live.again();
    await flush(10);
    expect(blockOrder(live.container)).toEqual([...homeBlockOrder('new')]);
  });

  it('mở lần đầu mà phiên đã lỗi và máy chưa nhớ loại khách: bố cục khách mới ngay, không chờ khung chờ chung', async () => {
    routes['/categories'] = () => new Promise(() => undefined);
    mocks.phase = 'unavailable';
    mocks.restoring = false;
    live = mountLive();
    await flush(10);
    expect(blockOrder(live.container)).toEqual([...homeBlockOrder('new')]);
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

  it('Giờ vàng (truy vấn quyết định) lỗi lúc đang giữ khung chờ: thả khung chờ, khối Giờ vàng hiện lỗi kèm "Thử lại", bấm Thử lại tải lại đúng khối đó', async () => {
    const purchased = deferred<unknown>();
    const flash = deferred<unknown>();
    routes['/me/purchased-items'] = () => purchased.promise;
    routes['/flash-sales/active'] = () => flash.promise;
    live = mountLive();
    await flush(10);
    expect(blockOrder(live.container)).toEqual([...homeRenderOrder('unknown', true)]);

    purchased.resolve({ items: [{ variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: '2026-01-01' }], nextCursor: null });
    await flush(10);
    expect(blockOrder(live.container)).toEqual([...homeRenderOrder('returning', true)]);

    flash.reject(new ApiError('Máy chủ đang bận', 503));
    await flush(10);
    expect(blockOrder(live.container)).toEqual([...homeBlockOrder('returning')]);
    const err = live.container.querySelector('[data-testid="home-block-error"]');
    expect(err).not.toBeNull();
    const before = calls('/flash-sales/active').length;
    routes['/flash-sales/active'] = () => [];
    click(byText(err as HTMLElement, 'button', 'Thử lại'));
    await flush(10);
    expect(calls('/flash-sales/active').length).toBeGreaterThan(before);
    expect(live.container.querySelector('[data-testid="home-block-error"]')).toBeNull();
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
    expect(blockOrder(live.container)).toEqual([...homeRenderOrder('unknown', true)]);
    await tick(HOME_SETTLE_MAX_MS - 100);
    expect(blockOrder(live.container)).toEqual([...homeRenderOrder('unknown', true)]);
    await tick(200);
    expect(blockOrder(live.container)).toEqual([...homeBlockOrder('unknown')]);
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
    expect(blockOrder(live.container)).toEqual([...homeBlockOrder('new')]);
    expect(region(live.container, 'Bán chạy nhất')).not.toBeNull();

    routes['/me/purchased-items'] = () => new Promise(() => undefined);
    mocks.phase = 'loading';
    mocks.restoring = true;
    live.again();
    await tick(HOME_SETTLE_MAX_MS - 100);
    expect(blockOrder(live.container)).toEqual([...homeKeptOrder('unknown')]);

    // Hẹn giờ nhả khung chờ: loại khách vẫn "chưa biết" nhưng khối đã dựng ở lại.
    await tick(200);
    expect(blockOrder(live.container)).toEqual([...homeKeptOrder('unknown')]);
    expect(region(live.container, 'Bán chạy nhất')!.textContent).toContain('Hạng nhất A');
    expect(region(live.container, 'Gợi ý hôm nay')).not.toBeNull();

    routes['/me/purchased-items'] = () => ({ items: [], nextCursor: null });
    mocks.phase = 'authenticated';
    mocks.restoring = false;
    live.again();
    await tick(50);
    expect(blockOrder(live.container)).toEqual([...homeBlockOrder('new')]);
    expect(region(live.container, 'Bán chạy nhất')!.textContent).toContain('Hạng nhất A');
  });
});
