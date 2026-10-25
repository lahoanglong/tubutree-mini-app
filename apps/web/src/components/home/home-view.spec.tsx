// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { newTestClient } from '@/test-utils/render-hook';
import { ApiError } from '@/lib/client-api';

// Chép ý nghĩa pages/home.spec của Mini App (phương án A, 9 khối): thứ tự khối theo khách cũ/mới, một lưới gợi ý, khối lỗi + Thử lại, lỗi cấp trang, khách vãng lai, chuông.
const mocks = vi.hoisted(() => ({ get: vi.fn(), push: vi.fn(), phase: 'authenticated', user: { id: 'u1', fullName: 'Lan', pointsBalance: 0 } as unknown }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: mocks.phase === 'authenticated' ? mocks.user : null }) }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
const routeState = vi.hoisted(() => ({ pending: new Set<string>() }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => !routeState.pending.has(p) }));

import HomeView from './home-view';
import { homeBlockOrder } from './home-blocks';
import { HOME_KIND_KEY } from './use-home-customer-kind';

const CONFIG = {
  freeshipThreshold: 350_000, subscribeDiscountPct: 0.17, affiliateWalletMultiplier: 1, affiliateMinWithdrawBank: 50_000, cashbackHoldDays: 30,
  loyalty: { vndPerPoint: 20_000, vndPerPointRedeem: 1_000 }, 
};
const card = (id: string, name: string) => ({ id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 50000, salePrice: null, isFeatured: true, inStock: true });
const PAGE = (items: ReturnType<typeof card>[]) => ({ data: items, meta: { page: 1, limit: 6, total: items.length } });
const CATEGORIES = [{ id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4 }];

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
  routeState.pending = new Set();
  mocks.phase = 'authenticated';
  mocks.user = { id: 'u1', fullName: 'Lan', pointsBalance: 0 };
  mocks.push.mockReset();
  routes = {
    '/products': (q) => (q?.sort === 'best_seller' ? PAGE([card('bs', 'Bán chạy nhất')]) : q?.sort === 'newest' ? PAGE([card('nw', 'Mới nhất')]) : PAGE([card('f1', 'Trùng gợi ý'), card('f2', 'Chỉ nổi bật')])),
    '/products/for-you': () => [card('f1', 'Trùng gợi ý')],
    '/brands': () => [],
    '/categories': () => CATEGORIES,
    '/me/notifications': () => [],
    '/me/purchased-items': () => ({ items: [], nextCursor: null }),
    '/config/public': () => CONFIG,
    '/me/new-customer-offer': () => ({ isNewCustomer: true, welcomeVoucher: null }),
    '/orders/active-count': () => ({ count: 0 }),
    '/me/subscriptions': () => [],
    '/me/loyalty': () => ({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 }),
    '/me/coupons': () => [],
    '/me/loyalty/check-in-status': () => ({ checkedInToday: true, streakDays: 1, rewards: [] }),
    '/feed': () => ({ posts: [] }),
    '/flash-sales/active': () => [],
    '/flash-sales/upcoming': () => [],
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
    expect(region(c, 'Bán chạy')).not.toBeNull();
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

  it('khách mới nhưng API báo không còn là khách mới → không hiện Quà khách mới', async () => {
    routes['/me/new-customer-offer'] = () => ({ isNewCustomer: false, welcomeVoucher: null });
    const c = await mount();
    expect(region(c, 'Quà khách mới')).toBeNull();
  });
});

describe('HomeView — nội dung các khối', () => {
  it('"Bán chạy" dùng sort=best_seller; lưới gợi ý xin trang đầu mặc định và không còn gọi newest/nổi bật riêng', async () => {
    const c = await mount();
    const calledSorts = productCalls().map((q) => q.sort);
    expect(calledSorts).toEqual(expect.arrayContaining(['best_seller', undefined]));
    expect(calledSorts).not.toContain('newest');
    expect(region(c, 'Bán chạy')!.textContent).toContain('Bán chạy nhất');
  });

  it('chỉ MỘT lưới gợi ý: "Gợi ý cho bạn" có chip Cho bạn, Bán chạy, Mới; Dành cho bạn đứng đầu và không trùng sản phẩm', async () => {
    const c = await mount();
    const feed = region(c, 'Gợi ý cho bạn')!;
    expect(feed).not.toBeNull();
    expect(feed.querySelectorAll('ul[aria-hidden="true"]')).toHaveLength(0);
    const chips = Array.from(feed.querySelectorAll('button')).map((b) => b.textContent);
    expect(chips).toEqual(expect.arrayContaining(['Cho bạn', 'Bán chạy', 'Mới']));
    const names = Array.from(feed.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(names.filter((t) => t.includes('Trùng gợi ý'))).toHaveLength(1);
    expect(names[0]).toContain('Trùng gợi ý');
  });

  it('đổi chip sang Mới tải lưới theo sort=newest', async () => {
    const c = await mount();
    click(byText(region(c, 'Gợi ý cho bạn')!, 'button', 'Mới'));
    await flush(8);
    expect(productCalls().some((q) => q.sort === 'newest')).toBe(true);
    expect(region(c, 'Gợi ý cho bạn')!.textContent).toContain('Mới nhất');
  });

  it('"Bán chạy" có nút Xem tất cả sang /san-pham?sort=best_seller', async () => {
    const c = await mount();
    const seeAll = c.querySelector<HTMLAnchorElement>('a[aria-label="Xem tất cả Bán chạy"], button[aria-label="Xem tất cả Bán chạy"]');
    expect(seeAll).not.toBeNull();
  });

  it('ô tìm là vỏ: dẫn sang /san-pham?focus=search; chạm danh mục sang /san-pham lọc theo danh mục', async () => {
    const c = await mount();
    const search = c.querySelector('a[aria-label="Bạn đang tìm gì hôm nay?"]');
    expect(search?.getAttribute('href')).toBe('/san-pham?focus=search');
    // D7-31: từ md thanh đầu website đã có ô tìm, ô này chỉ còn ở điện thoại.
    expect(search?.className).toMatch(/\bmd:hidden\b/);
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

describe('HomeView — chuông và khách vãng lai', () => {
  it('chuông báo số tin chưa đọc (chỉ khi đã đăng nhập), dẫn sang trang Thông báo', async () => {
    routes['/me/notifications'] = () => [{ id: 'n1', status: 'SENT' }, { id: 'n2', status: 'READ' }, { id: 'n3', status: 'SENT' }];
    const c = await mount();
    const bell = c.querySelector<HTMLAnchorElement>('a[aria-label="Thông báo, 2 chưa đọc"]')!;
    expect(bell.getAttribute('href')).toBe('/tai-khoan/thong-bao');
    expect(bell.querySelector('[aria-label="2 thông báo chưa đọc"]')?.textContent).toBe('2');
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
    for (const p of ['/products/for-you', '/me/notifications', '/me/purchased-items', '/me/new-customer-offer', '/orders/active-count', '/me/loyalty']) {
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
      return q?.sort === 'best_seller' ? PAGE([card('bs', 'Bán chạy nhất')]) : PAGE([card('f2', 'Chỉ nổi bật')]);
    };
    routes['/products/for-you'] = () => [];
    const c = await mount();
    const err = region(c, 'Gợi ý cho bạn')!;
    expect(err.textContent).toContain('Máy chủ đang bận');
    expect(region(c, 'Bán chạy')!.textContent).toContain('Bán chạy nhất');
    expect(c.querySelector('[data-testid="home-page-error"]')).toBeNull();
    fail = false;
    click(err.querySelector('button[aria-label="Thử lại Gợi ý cho bạn"]'));
    await flush(8);
    expect(region(c, 'Gợi ý cho bạn')!.textContent).not.toContain('Máy chủ đang bận');
    expect(region(c, 'Gợi ý cho bạn')!.textContent).toContain('Chỉ nổi bật');
  });

  it('API sập hẳn (Bán chạy lỗi, chưa có dữ liệu) → MỘT dải lỗi cấp trang ngay dưới ô tìm, không thẻ lỗi từng khối; thử lại xong thì dải biến mất', async () => {
    let down = true;
    routes['/products'] = (q) => {
      if (down) throw new ApiError('Mất kết nối', 503);
      return q?.sort === 'best_seller' ? PAGE([card('bs', 'Bán chạy nhất')]) : PAGE([card('f2', 'Chỉ nổi bật')]);
    };
    const c = await mount();
    expect(c.querySelectorAll('[data-testid="home-page-error"]')).toHaveLength(1);
    expect(c.querySelectorAll('[data-testid="home-block-error"]')).toHaveLength(0);
    expect(blockOrder(c)[1]).toBe('pageError');
    down = false;
    click(c.querySelector('[data-testid="home-page-error"] button'));
    await flush(10);
    expect(c.querySelector('[data-testid="home-page-error"]')).toBeNull();
    expect(c.textContent).toContain('Bán chạy nhất');
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
          bestSellers: PAGE([card('bs', 'Bán chạy từ server')]),
          suggest: PAGE([card('f2', 'Gợi ý từ server')]),
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
