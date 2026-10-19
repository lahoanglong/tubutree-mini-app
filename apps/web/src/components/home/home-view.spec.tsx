// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { newTestClient } from '@/test-utils/render-hook';
import { ApiError } from '@/lib/client-api';

// Chép ý nghĩa pages/home.spec của Mini App: thứ tự khối theo khách cũ/mới, cờ bố cục, bỏ trùng, khối lỗi + Thử lại, lỗi cấp trang, khách vãng lai, chuông.
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
  loyalty: { vndPerPoint: 20_000, vndPerPointRedeem: 1_000 }, homeNewCustomerLayout: false,
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

describe('HomeView — thứ tự khối', () => {
  it('khách mới: thứ tự khối "new" (Bán chạy + Danh mục trước Dành cho bạn), Mua lại + dải đơn giữ ô 2-3', async () => {
    const c = await mount();
    expect(blockOrder(c)).toEqual([...homeBlockOrder('new')]);
    expect(blockOrder(c).slice(1, 3)).toEqual(['purchased', 'orderStrip']);
    expect(calls('/me/purchased-items')[0]![1]).toEqual({ query: { limit: 10 } });
  });

  it('khách cũ: thứ tự khối "returning" sau khi purchased-items có hàng, có dải tăng điểm sau dải đơn', async () => {
    routes['/me/purchased-items'] = () => ({ items: [{ variationId: 'v1', productId: 'p1', slug: 's', productName: 'Nước rửa chén', variationName: '', brand: 'Tubu', thumbnail: null, price: 1000, salePrice: null, stock: 3, inStock: true, timesBought: 1, lastPurchasedAt: '2026-01-01' }], nextCursor: null });
    routes['/config/public'] = () => ({ ...CONFIG, loyalty: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000 } });
    const c = await mount();
    expect(blockOrder(c)).toEqual([...homeBlockOrder('returning')]);
    expect(block(c, 'orderStrip').querySelector('[data-testid="points-boost"]')).not.toBeNull();
    expect(block(c, 'welcome')).toBeNull();
  });

  it('khách cũ đã được nhớ: ngay từ khung hình đầu đã theo thứ tự returning, dù purchased-items còn tải', async () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    routes['/me/purchased-items'] = () => new Promise(() => undefined);
    const c = await mount();
    expect(blockOrder(c)).toEqual([...homeBlockOrder('returning')]);
    expect(calls('/me/new-customer-offer')).toHaveLength(0);
  });

  it('cờ home.new_customer_layout bật: Quà khách mới + Danh mục lên trước giờ vàng; cờ tắt hoặc cấu hình lỗi → bố cục cũ', async () => {
    routes['/config/public'] = () => ({ ...CONFIG, homeNewCustomerLayout: true });
    expect(blockOrder(await mount())).toEqual([...homeBlockOrder('new', true)]);
    mounted!.unmount();
    routes['/config/public'] = () => Promise.reject(new Error('mạng'));
    expect(blockOrder(await mount())).toEqual([...homeBlockOrder('new')]);
  });

  it('khách mới nhưng API báo không còn là khách mới → không hiện Quà khách mới', async () => {
    routes['/me/new-customer-offer'] = () => ({ isNewCustomer: false, welcomeVoucher: null });
    const c = await mount();
    expect(region(c, 'Quà khách mới')).toBeNull();
  });
});

describe('HomeView — nội dung các khối', () => {
  it('"Bán chạy" dùng sort=best_seller; "Tubu chọn cho bạn" xin 12 rồi bỏ SP đã có ở "Dành cho bạn"', async () => {
    const c = await mount();
    expect(productCalls()).toEqual(expect.arrayContaining([{ limit: 6, sort: 'best_seller' }, { limit: 12 }, { limit: 6, sort: 'newest' }]));
    expect(region(c, 'Dành cho bạn')!.textContent).toContain('Trùng gợi ý');
    const featured = region(c, 'Tubu chọn cho bạn')!;
    expect(featured.textContent).toContain('Chỉ nổi bật');
    expect(featured.textContent).not.toContain('Trùng gợi ý');
  });

  it('"Xem tất cả" dẫn tới /san-pham đúng bộ sắp xếp; "Dành cho bạn" không có nút này', async () => {
    const c = await mount();
    const seeAll = (name: string) => c.querySelector<HTMLAnchorElement>(`a[aria-label="Xem tất cả ${name}"]`)?.getAttribute('href');
    expect(seeAll('Bán chạy')).toBe('/san-pham?sort=best_seller');
    expect(seeAll('Mới về vườn')).toBe('/san-pham?sort=newest');
    expect(seeAll('Tubu chọn cho bạn')).toBe('/san-pham');
    expect(seeAll('Dành cho bạn')).toBeUndefined();
  });

  it('"Tubu chọn cho bạn" chờ "Dành cho bạn" xong mới hiện (khung chờ 6 ô, tránh 6 → 5 ô khi bỏ trùng)', async () => {
    routes['/products/for-you'] = () => new Promise(() => undefined);
    const c = await mount();
    const featured = region(c, 'Tubu chọn cho bạn')!;
    expect(featured.querySelectorAll('li')).toHaveLength(6);
    expect(featured.textContent).not.toContain('Chỉ nổi bật');
  });

  it('"Dành cho bạn" lỗi: không kẹt ở khung chờ, vẫn hiện SP nổi bật', async () => {
    routes['/products/for-you'] = () => Promise.reject(new ApiError('Lỗi', 500));
    const c = await mount();
    expect(region(c, 'Tubu chọn cho bạn')!.textContent).toContain('Trùng gợi ý');
  });

  it('ô tìm là vỏ: dẫn sang /san-pham?focus=search; chạm danh mục sang /san-pham lọc theo danh mục', async () => {
    const c = await mount();
    expect(c.querySelector('a[aria-label="Bạn đang tìm gì hôm nay?"]')?.getAttribute('href')).toBe('/san-pham?focus=search');
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

  it('khách chưa đăng nhập: không gọi for-you/notifications/purchased-items, không có chuông và "Dành cho bạn"; vẫn thấy Quà khách mới (chỉ lợi ích)', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    for (const p of ['/products/for-you', '/me/notifications', '/me/purchased-items', '/me/new-customer-offer', '/orders/active-count']) {
      expect(calls(p)).toHaveLength(0);
    }
    expect(c.querySelector('a[aria-label^="Thông báo"]')).toBeNull();
    expect(region(c, 'Dành cho bạn')).toBeNull();
    expect(region(c, 'Quà khách mới')).not.toBeNull();
  });
});

describe('HomeView — lỗi từng khối và lỗi cấp trang', () => {
  it('một khối lỗi hiện thông báo + "Thử lại" ngay tại chỗ, khối khác vẫn hiện; thử lại chỉ tải lại khối đó', async () => {
    let fail = true;
    routes['/products'] = (q) => {
      if (q?.sort === 'newest' && fail) throw new ApiError('Máy chủ đang bận', 503);
      return q?.sort === 'best_seller' ? PAGE([card('bs', 'Bán chạy nhất')]) : PAGE([card('f2', 'Chỉ nổi bật')]);
    };
    const c = await mount();
    const err = region(c, 'Mới về vườn')!;
    expect(err.textContent).toContain('Máy chủ đang bận');
    expect(region(c, 'Bán chạy')!.textContent).toContain('Bán chạy nhất');
    expect(c.querySelector('[data-testid="home-page-error"]')).toBeNull();
    const before = productCalls().length;
    fail = false;
    click(err.querySelector('button[aria-label="Thử lại Mới về vườn"]'));
    await flush(8);
    expect(productCalls().slice(before)).toEqual([{ limit: 6, sort: 'newest' }]);
    expect(region(c, 'Mới về vườn')!.textContent).not.toContain('Máy chủ đang bận');
  });

  it('API sập hẳn (cả 3 lưới lỗi) → MỘT dải lỗi cấp trang + một nút "Thử lại", không còn thẻ lỗi từng khối; thử lại xong thì dải biến mất', async () => {
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

  it('kệ "Mua lại" lỗi thật (không phải 404) → khối lỗi + "Thử lại"; 404 của API cũ vẫn ẩn lặng lẽ', async () => {
    routes['/me/purchased-items'] = () => Promise.reject(new ApiError('Máy chủ đang bận', 503));
    const c = await mount();
    expect(block(c, 'purchased').textContent).toContain('Máy chủ đang bận');
    expect(block(c, 'purchased').querySelector('button[aria-label="Thử lại Mua lại"]')).not.toBeNull();
    mounted!.unmount();
    routes['/me/purchased-items'] = () => Promise.reject(new ApiError('Không tìm thấy', 404));
    const c2 = await mount();
    expect(block(c2, 'purchased').textContent).toBe('');
  });
});

describe('HomeView — dữ liệu server tải sẵn', () => {
  it('có initial thì không khung chờ và không gọi lại ngay các lưới công khai', async () => {
    const c = await mount(
      <HomeView
        initial={{
          bestSellers: PAGE([card('bs', 'Bán chạy từ server')]),
          featured: PAGE([card('f2', 'Nổi bật từ server')]),
          newest: PAGE([card('nw', 'Mới từ server')]),
          categories: CATEGORIES,
        }}
      />,
    );
    expect(c.textContent).toContain('Bán chạy từ server');
    expect(c.textContent).toContain('Mới từ server');
    expect(productCalls()).toEqual([]);
    expect(calls('/categories')).toHaveLength(0);
  });
});

