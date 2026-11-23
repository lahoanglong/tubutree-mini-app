// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { subtotalBucket } from '@tubutree/shared-types';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { formatVnd } from '@/lib/format-vnd';

// /gio-hang khi chưa đăng nhập: cờ web.guest_cart_enabled bật thì hiện giỏ khách (localStorage + giá lấy lại từ API công khai),
// tắt thì giữ tường đăng nhập cũ; đăng nhập xong mà có lời báo gộp giỏ thì hiện một lần ở đầu giỏ.

const state = vi.hoisted(() => ({
  auth: { user: null, status: 'idle', initialized: true } as Record<string, unknown>,
  track: vi.fn(),
  cart: null as unknown,
  addToCart: vi.fn(),
  getProductStock: vi.fn(),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/gio-hang',
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => state.auth }));
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackPurchase: state.track,
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => state.cart,
  addToCart: (variationId: string, quantity: number) => state.addToCart(variationId, quantity),
  getProductStock: (slug: string) => state.getProductStock(slug),
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  getCartSelection: async () => {
    throw new Error('chưa mock');
  },
}));

import CartPage from './cart-page';
import { GuestCartView } from './guest-cart-view';
import { CART_EMPTY, CART_OUT_OF_STOCK } from '@tubutree/app-core/cart-copy';
import { resetFlashSales } from '@/lib/use-flash-sales';
import { PUBLIC_CONFIG_FALLBACK } from '@/lib/use-public-config';
import { GUEST_CART_KEY } from '@/lib/guest-cart/store';
import { GUEST_MERGE_NOTE_KEY } from '@/lib/guest-cart/after-login';
import { GUEST_REORDER_NOTE_KEY } from '@/lib/guest-cart/reorder';
import { GUEST_MERGE_CLAIM_KEY, resetGuestMergeForTest } from '@/lib/guest-cart/merge';

const PRODUCT = {
  id: 'p1',
  slug: 'dau-goi',
  brand: 'Tubu',
  name: 'Dầu gội bồ kết',
  shortDesc: null,
  description: '',
  images: [],
  thumbnail: null,
  basePrice: 200_000,
  salePrice: 150_000,
  certifications: [],
  variations: [{ id: 'v1', sku: 'S1', name: '250ml', retailPrice: 200_000, salePrice: 150_000, stock: 5 }],
};

const SOLD_OUT = {
  ...PRODUCT,
  id: 'p2',
  slug: 'het-hang',
  name: 'Xà phòng thảo mộc',
  variations: [{ id: 'v2', sku: 'S2', name: '100g', retailPrice: 50_000, salePrice: null, stock: 0 }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let calls: URL[] = [];
let configHangs = false;

const clientWith = (flag: boolean | null) => {
  // retryDelay 0: giá sản phẩm giỏ khách tự thử lại một lần (products.ts), không để test chờ 1 giây.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } });
  if (flag !== null) qc.setQueryData(['public-config'], { ...PUBLIC_CONFIG_FALLBACK, webGuestCartEnabled: flag });
  return qc;
};
const putGuestLines = (lines: { variationId: string; slug: string; quantity: number }[]) =>
  localStorage.setItem(GUEST_CART_KEY, JSON.stringify(lines.map((l) => ({ ...l, addedAt: 1 }))));
const named = (name: string) => state.track.mock.calls.filter((c) => c[0] === name);

let mounted: Rendered[] = [];
const mount = async (qc: QueryClient, until: (c: HTMLElement) => boolean) => {
  const r = render(<CartPage />, qc);
  mounted.push(r);
  for (let i = 0; i < 100 && !until(r.container); i++) await flush(1);
  await flush(4);
  return r.container;
};

// Giỏ trống là chunk dynamic(): nạp sẵn một lần (như trình duyệt đã có chunk), để ca chờ "Giỏ còn trống" không phụ thuộc thời gian dịch module khi máy bận.
beforeAll(async () => {
  await import('./empty-cart');
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetFlashSales();
  state.auth = { user: null, status: 'idle', initialized: true };
  state.track.mockReset();
  state.cart = null;
  state.addToCart.mockReset().mockImplementation(async () => state.cart);
  state.getProductStock.mockReset().mockResolvedValue({});
  resetGuestMergeForTest();
  calls = [];
  configHangs = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url);
      calls.push(u);
      if (u.pathname.endsWith('/config/public')) {
        if (configHangs) return new Promise<Response>(() => {});
        return json({ ...PUBLIC_CONFIG_FALLBACK, webGuestCartEnabled: true });
      }
      if (u.pathname.endsWith('/products/dau-goi')) return json(PRODUCT);
      if (u.pathname.endsWith('/products/het-hang')) return json(SOLD_OUT);
      if (u.pathname.endsWith('/products/da-go')) return json({ message: 'Không tìm thấy' }, 404);
      if (u.pathname.endsWith('/products/loi')) return json({ message: 'Lỗi máy chủ' }, 500);
      if (u.pathname.endsWith('/products')) return json({ data: [], meta: { page: 1, limit: 4, total: 0 } });
      if (u.pathname.endsWith('/flash-sales/active')) return json([]);
      if (u.pathname.includes('/wishlist')) return json([]);
      return json({});
    }),
  );
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('/gio-hang — khách chưa đăng nhập, cờ giỏ khách bật', () => {
  it('vẽ dòng với giá lấy từ API công khai, một nút chính "Đăng nhập để đặt hàng", không có ô mã giảm giá', async () => {
    putGuestLines([{ variationId: 'v1', slug: 'dau-goi', quantity: 2 }]);
    const c = await mount(clientWith(true), (el) => !!el.querySelector('[data-testid="cart-line"][data-state="ok"]'));

    const rows = c.querySelectorAll('[data-testid="cart-line"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('data-variation-id')).toBe('v1');
    expect(rows[0]!.textContent).toContain('Dầu gội bồ kết');
    expect(rows[0]!.textContent).toContain(formatVnd(150_000));
    expect(rows[0]!.textContent).toContain(formatVnd(200_000));
    expect(rows[0]!.textContent).toContain(formatVnd(300_000));
    expect(calls.some((u) => u.pathname.endsWith('/products/dau-goi'))).toBe(true);
    expect(c.querySelector('[data-testid="cart-total-value"]')!.textContent).toBe(formatVnd(300_000));

    // Một nút cho mỗi bố cục: khung tóm tắt (từ lg) và thanh dính đáy (dưới lg), cùng chữ và cùng đích.
    const login = Array.from(c.querySelectorAll<HTMLAnchorElement>('a[href^="/dang-nhap"]'));
    expect(login).toHaveLength(2);
    for (const a of login) {
      expect(a.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fgio-hang');
      expect(a.textContent).toBe('Đăng nhập để đặt hàng');
      expect(a.dataset.testid).toBe('guest-cart-login');
    }
    expect(c.querySelector('[data-testid="cart-summary"]')!.querySelectorAll('a[data-testid="guest-cart-login"]')).toHaveLength(1);
    expect(c.querySelector('[data-testid="sticky-bar"]')!.querySelectorAll('a[data-testid="guest-cart-login"]')).toHaveLength(1);

    expect(c.querySelector('[data-testid="coupon-row"]')).toBeNull();
    expect(c.textContent).not.toContain('Mã giảm giá');
    expect(c.textContent).not.toContain('Đăng nhập để xem giỏ hàng của bạn.');
    expect(c.querySelector('a[href="/thanh-toan"]')).toBeNull();
  });

  it('cart_viewed và login_wall_shown {from:"/gio-hang"} phát đúng một lần, kể cả khi đổi số lượng sau đó', async () => {
    putGuestLines([{ variationId: 'v1', slug: 'dau-goi', quantity: 2 }]);
    const c = await mount(clientWith(true), (el) => !!el.querySelector('[data-testid="cart-line"][data-state="ok"]'));

    expect(named('cart_viewed')).toEqual([['cart_viewed', { itemCount: 1, subtotalBucket: subtotalBucket(300_000) }]]);
    expect(named('login_wall_shown')).toEqual([['login_wall_shown', { from: '/gio-hang' }]]);

    click(c.querySelector('button[aria-label="Tăng số lượng Dầu gội bồ kết"]'));
    await flush();
    expect(JSON.parse(localStorage.getItem(GUEST_CART_KEY)!)[0].quantity).toBe(3);
    expect(c.querySelector('[data-testid="cart-total-value"]')!.textContent).toBe(formatVnd(450_000));
    expect(named('cart_viewed')).toHaveLength(1);
    expect(named('login_wall_shown')).toHaveLength(1);
  });

  it('xoá dòng cuối: giỏ khách trống thì hiện giỏ trống', async () => {
    putGuestLines([{ variationId: 'v1', slug: 'dau-goi', quantity: 1 }]);
    const c = await mount(clientWith(true), (el) => !!el.querySelector('[data-testid="cart-line"][data-state="ok"]'));
    click(c.querySelector('button[aria-label="Xoá Dầu gội bồ kết khỏi giỏ hàng"]'));
    for (let i = 0; i < 100 && !c.textContent?.includes('Giỏ còn trống đấy'); i++) await flush(1);
    expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
    expect(c.querySelector('[data-testid="guest-cart"]')).toBeNull();
    expect(c.textContent).toContain('Giỏ còn trống đấy');
  });

  it('giỏ khách trống: hiện giỏ trống, không có tường đăng nhập, không phát login_wall_shown', async () => {
    const c = await mount(clientWith(true), (el) => !!el.textContent?.includes('Giỏ còn trống đấy'));
    expect(c.textContent).toContain('Giỏ còn trống đấy');
    expect(c.querySelector('[data-testid="guest-cart"]')).toBeNull();
    expect(c.textContent).not.toContain('Đăng nhập để xem giỏ hàng của bạn.');
    expect(named('cart_viewed')).toEqual([['cart_viewed', { itemCount: 0, subtotalBucket: subtotalBucket(0) }]]);
    expect(named('login_wall_shown')).toHaveLength(0);
  });

  it('cờ đang tải lần đầu mà giỏ khách có món: khung chờ, không chớp tường đăng nhập', async () => {
    configHangs = true;
    putGuestLines([{ variationId: 'v1', slug: 'dau-goi', quantity: 1 }]);
    const c = await mount(clientWith(null), () => false);
    expect(c.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(c.textContent).not.toContain('Đăng nhập để xem giỏ hàng của bạn.');
    expect(c.querySelector('[data-testid="guest-cart"]')).toBeNull();
  });

  it('cờ đang tải lần đầu mà giỏ khách trống: hiện tường đăng nhập ngay, không chờ cấu hình', async () => {
    configHangs = true;
    const qc = clientWith(null);
    const r = render(<CartPage />, qc);
    mounted.push(r);
    await flush(2);
    expect(qc.getQueryState(['public-config'])?.status).toBe('pending');
    expect(r.container.textContent).toContain('Đăng nhập để xem giỏ hàng của bạn.');
    expect(r.container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

describe('/gio-hang — khách chưa đăng nhập, cờ giỏ khách tắt', () => {
  it('giữ tường đăng nhập cũ; giỏ khách trong máy không bị đụng và không tải giá', async () => {
    putGuestLines([{ variationId: 'v1', slug: 'dau-goi', quantity: 2 }]);
    const before = localStorage.getItem(GUEST_CART_KEY);
    const c = await mount(clientWith(false), (el) => !!el.textContent?.includes('Đăng nhập để xem giỏ hàng của bạn.'));
    expect(c.textContent).toContain('Đăng nhập để xem giỏ hàng của bạn.');
    expect(c.querySelector('[data-testid="guest-cart"]')).toBeNull();
    expect(c.querySelector('[data-testid="cart-line"]')).toBeNull();
    expect(c.querySelector('a[href="/dang-nhap?returnTo=%2Fgio-hang"]')!.textContent).toBe('Đăng nhập với Zalo');
    expect(calls.some((u) => u.pathname.endsWith('/products/dau-goi'))).toBe(false);
    expect(localStorage.getItem(GUEST_CART_KEY)).toBe(before);
  });
});

describe('/gio-hang — đã đăng nhập, lời báo gộp giỏ khách', () => {
  const cartOf = (items: unknown[]) => ({
    items, couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 2,
  });
  const serverLine = {
    id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết', variationName: '500ml', slug: 'dau-goi', thumbnail: null,
    unitPrice: 150000, quantity: 2, stock: 5, total: 300000,
  };

  beforeEach(() => {
    state.auth = { user: { id: 'u' }, status: 'authenticated', initialized: true };
    state.cart = cartOf([serverLine]);
  });

  it('có lời báo còn hạn: hiện một lần ở đầu giỏ (số món lỗi và số món bị giảm), rồi xoá khỏi bộ nhớ', async () => {
    sessionStorage.setItem(GUEST_MERGE_NOTE_KEY, JSON.stringify({ failedLines: 1, reduced: 2, at: Date.now() }));
    const c = await mount(clientWith(true), (el) => !!el.querySelector('[data-testid="guest-merge-note"]'));
    const note = c.querySelector('[data-testid="guest-merge-note"]')!;
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toContain(fillCopy('guestCart.mergeFailed', { n: 1 }));
    expect(note.textContent).toContain(fillCopy('guestCart.mergeReduced', { n: 2 }));
    expect(sessionStorage.getItem(GUEST_MERGE_NOTE_KEY)).toBeNull();
    expect(c.querySelector('[data-testid="cart-line"]')).not.toBeNull();
  });

  it('không có lời báo: không có khối báo', async () => {
    const c = await mount(clientWith(true), (el) => !!el.querySelector('[data-testid="cart-line"]'));
    expect(c.querySelector('[data-testid="guest-merge-note"]')).toBeNull();
    expect(state.addToCart).not.toHaveBeenCalled();
  });

  it('cờ bật mà giỏ khách còn món (lúc đăng nhập chưa gộp được): mở giỏ thì gộp nốt và báo món không chuyển được', async () => {
    putGuestLines([
      { variationId: 'v8', slug: 'con-hang', quantity: 2 },
      { variationId: 'v9', slug: 'het-hang', quantity: 1 },
    ]);
    state.getProductStock.mockImplementation(async (slug: string) => (slug === 'con-hang' ? { v8: 10 } : { v9: 0 }));
    const c = await mount(clientWith(true), (el) => !!el.querySelector('[data-testid="guest-merge-note"]'));

    expect(state.addToCart.mock.calls).toEqual([['v8', 2]]);
    expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
    expect(sessionStorage.getItem(GUEST_MERGE_CLAIM_KEY)).toBeNull();
    const note = c.querySelector('[data-testid="guest-merge-note"]')!;
    expect(note.textContent).toContain(fillCopy('guestCart.mergeFailed', { n: 1 }));
    expect(sessionStorage.getItem(GUEST_MERGE_NOTE_KEY)).toBeNull();
  });

  it('gộp nốt gặp lỗi tạm: món ở lại giỏ khách và báo "chưa chuyển được"', async () => {
    putGuestLines([{ variationId: 'v8', slug: 'con-hang', quantity: 1 }]);
    state.getProductStock.mockResolvedValue({ v8: 10 });
    state.addToCart.mockRejectedValue(Object.assign(new Error('Bảo trì'), { status: 503 }));
    const c = await mount(clientWith(true), (el) => !!el.querySelector('[data-testid="guest-merge-note"]'));
    expect(c.querySelector('[data-testid="guest-merge-note"]')!.textContent).toContain(fillCopy('guestCart.mergeKept', { n: 1 }));
    expect(JSON.parse(localStorage.getItem(GUEST_CART_KEY)!).map((l: { variationId: string }) => l.variationId)).toEqual(['v8']);
  });

  it('cờ tắt: không gộp giỏ khách khi mở giỏ', async () => {
    putGuestLines([{ variationId: 'v8', slug: 'con-hang', quantity: 1 }]);
    const c = await mount(clientWith(false), (el) => !!el.querySelector('[data-testid="cart-line"]'));
    expect(state.addToCart).not.toHaveBeenCalled();
    expect(state.getProductStock).not.toHaveBeenCalled();
    expect(c.querySelector('[data-testid="guest-merge-note"]')).toBeNull();
    expect(localStorage.getItem(GUEST_CART_KEY)).not.toBeNull();
  });
});

describe('GuestCartView — dòng giỏ khách (khuôn Mini)', () => {
  const mountView = async (until: (c: HTMLElement) => boolean) => {
    const r = render(<GuestCartView empty={<p>Giỏ trống</p>} gridClassName="grid" />, clientWith(true));
    mounted.push(r);
    for (let i = 0; i < 100 && !until(r.container); i++) await flush(1);
    await flush(2);
    return r.container;
  };
  const btn = (c: HTMLElement, label: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const storedQty = () => JSON.parse(localStorage.getItem(GUEST_CART_KEY)!)[0].quantity as number;

  it('giỏ khách trống: vẽ phần `empty` được truyền vào', async () => {
    const c = await mountView((el) => !!el.textContent?.includes('Giỏ trống'));
    expect(c.textContent).toBe('Giỏ trống');
  });

  it('lưới nhận từ gridClassName', async () => {
    putGuestLines([{ variationId: 'v1', slug: 'dau-goi', quantity: 1 }]);
    const c = await mountView((el) => !!el.querySelector('[data-state="ok"]'));
    expect(c.querySelector('[data-testid="guest-cart"]')!.className).toBe('grid');
  });

  it('chạm trần tồn thấp: nút + aria-disabled và bấm không đổi gì; nút − kéo về 1 rồi cũng aria-disabled', async () => {
    putGuestLines([{ variationId: 'v1', slug: 'dau-goi', quantity: 5 }]);
    const c = await mountView((el) => !!el.querySelector('[data-state="ok"]'));
    const plus = btn(c, 'Tăng số lượng Dầu gội bồ kết')!;
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    expect(c.textContent).toContain('Chỉ còn 5 sản phẩm');
    click(plus);
    await flush(1);
    expect(storedQty()).toBe(5);

    const minus = () => btn(c, 'Giảm số lượng Dầu gội bồ kết')!;
    expect(minus().getAttribute('aria-disabled')).toBe('false');
    for (let i = 0; i < 4; i++) {
      click(minus());
      await flush(1);
    }
    expect(storedQty()).toBe(1);
    expect(minus().getAttribute('aria-disabled')).toBe('true');
    click(minus());
    await flush(1);
    expect(storedQty()).toBe(1);
    expect(btn(c, 'Tăng số lượng Dầu gội bồ kết')!.getAttribute('aria-disabled')).toBe('false');
  });

  it('dòng không mua được (hết hàng, đã gỡ): chỉ câu trạng thái và nút xoá, không có bộ chọn số lượng, không vào tạm tính', async () => {
    putGuestLines([
      { variationId: 'v1', slug: 'dau-goi', quantity: 1 },
      { variationId: 'v2', slug: 'het-hang', quantity: 2 },
      { variationId: 'v3', slug: 'da-go', quantity: 1 },
    ]);
    const c = await mountView((el) => el.querySelectorAll('[data-testid="cart-line"]:not([data-state="loading"])').length === 3);
    const rows = Array.from(c.querySelectorAll<HTMLElement>('[data-testid="cart-line"]'));
    expect(rows.map((r) => r.dataset.state)).toEqual(['ok', 'soldOut', 'gone']);

    const [, soldOut, gone] = rows;
    expect(soldOut!.textContent).toContain(CART_OUT_OF_STOCK);
    expect(soldOut!.querySelector('button[aria-label^="Tăng số lượng"], button[aria-label^="Giảm số lượng"]')).toBeNull();
    expect(soldOut!.querySelector('button[aria-label="Xoá Xà phòng thảo mộc khỏi giỏ hàng"]')).not.toBeNull();
    expect(gone!.textContent).toContain(fillCopy('guestCart.gone'));
    expect(gone!.querySelector('button[aria-label^="Tăng số lượng"]')).toBeNull();
    expect(gone!.querySelectorAll('button')).toHaveLength(1);
    expect(c.querySelector('[data-testid="cart-total-value"]')!.textContent).toBe(formatVnd(150_000));

    click(soldOut!.querySelector('button[aria-label="Xoá Xà phòng thảo mộc khỏi giỏ hàng"]'));
    await flush(1);
    expect(JSON.parse(localStorage.getItem(GUEST_CART_KEY)!).map((l: { variationId: string }) => l.variationId)).toEqual(['v1', 'v3']);
  });
});

describe('GuestCartView — tiêu đề dòng khi chưa có tên sản phẩm', () => {
  it('tải giá lỗi: tiêu đề "Sản phẩm trong giỏ", có nút Thử lại; sản phẩm đã gỡ vẫn ghi "Sản phẩm đã ngừng bán"', async () => {
    putGuestLines([
      { variationId: 'v4', slug: 'loi', quantity: 1 },
      { variationId: 'v3', slug: 'da-go', quantity: 1 },
    ]);
    const r = render(<GuestCartView empty={null} gridClassName="grid" />, clientWith(true));
    mounted.push(r);
    const c = r.container;
    const settled = () => c.querySelectorAll('[data-testid="cart-line"][data-state="error"], [data-testid="cart-line"][data-state="gone"]').length === 2;
    for (let i = 0; i < 100 && !settled(); i++) await flush(1);

    const title = (slug: string) => c.querySelector(`a[href="/san-pham/${slug}"]:not([aria-hidden])`)!.textContent;
    expect(title('loi')).toBe(fillCopy('guestCart.itemFallback'));
    expect(title('loi')).toBe('Sản phẩm trong giỏ');
    expect(c.querySelector('[data-state="error"]')!.textContent).toContain(fillCopy('guestCart.loadFailed'));
    expect(c.querySelector('[data-state="error"]')!.textContent).toContain(fillCopy('guestCart.retry'));
    expect(title('da-go')).toBe('Sản phẩm đã ngừng bán');
  });
});

describe('bản dựng sẵn cho khách (/gio-hang/khach): HTML máy chủ', () => {
  const tree = async (flag: boolean | null) => {
    const { QueryClientProvider } = await import('@tanstack/react-query');
    const { PrebuiltGuest } = await import('@/lib/auth-phase');
    const { QuerySeed } = await import('@/components/query-seed');
    // Chunk giỏ trống đã nạp (như trình duyệt đã có chunk khi hydrate): HTML máy chủ có nội dung thật, không phải khung chờ của dynamic().
    await import('./empty-cart');
    const entries = flag === null ? [] : [{ queryKey: ['public-config'], data: { ...PUBLIC_CONFIG_FALLBACK, webGuestCartEnabled: flag }, fetchedAt: Date.now() }];
    return (
      <QueryClientProvider client={new QueryClient()}>
        <PrebuiltGuest>
          <QuerySeed entries={entries}>
            <CartPage />
          </QuerySeed>
        </PrebuiltGuest>
      </QueryClientProvider>
    );
  };
  const ssr = async (flag: boolean | null, lines: { variationId: string; slug: string; quantity: number }[] = []) => {
    const { renderToString } = await import('react-dom/server');
    putGuestLines(lines);
    state.auth = { user: null, status: 'idle', initialized: false };
    return renderToString(await tree(flag));
  };

  /** HTML máy chủ (giỏ trống) rồi hydrate trên máy có giỏ khách trong localStorage mà chưa có cookie (giỏ từ trước khi có cookie, cookie hết hạn). */
  const hydrateWithLines = async (flag: boolean | null, lines: { variationId: string; slug: string; quantity: number }[]) => {
    const { hydrateRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const html = await ssr(flag);
    putGuestLines(lines);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const recoverable: unknown[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const element = await tree(flag);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError: (e) => recoverable.push(e) });
    });
    await flush(10);
    const hydrationLogs = errors.mock.calls.map((c) => String(c[0])).filter((m) => /hydrat/i.test(m));
    errors.mockRestore();
    return {
      container,
      recoverable,
      hydrationLogs,
      cleanup: () => {
        act(() => root!.unmount());
        container.remove();
      },
    };
  };

  it('cờ giỏ khách bật: HTML đầu là giỏ khách trống (không phải khung chờ đăng nhập hay tường đăng nhập)', async () => {
    const html = await ssr(true);
    expect(html).toContain(CART_EMPTY.heading);
    expect(html).not.toContain('Đăng nhập để xem giỏ hàng');
  });

  it('cờ tắt: HTML đầu là tường đăng nhập như bản thường sau khi tải xong', async () => {
    expect(await ssr(false)).toContain('Đăng nhập để xem giỏ hàng');
  });

  it('máy chủ không đọc localStorage: giỏ khách có món vẫn vẽ giỏ trống ở máy chủ (middleware không đưa khách có món tới đây)', async () => {
    const html = await ssr(true, [{ variationId: 'v1', slug: 'dau-goi', quantity: 1 }]);
    expect(html).toContain(CART_EMPTY.heading);
    expect(html).not.toContain('Dầu gội bồ kết');
  });

  it('khách có món mà chưa có cookie vẫn tới bản dựng sẵn: hydrate không lệch, rồi hiện món; cart_viewed đếm đúng số món, không phát với giỏ trống', async () => {
    const h = await hydrateWithLines(true, [{ variationId: 'v1', slug: 'dau-goi', quantity: 2 }]);
    try {
      expect(h.recoverable).toEqual([]);
      expect(h.hydrationLogs).toEqual([]);
      expect(h.container.textContent).toContain('Dầu gội bồ kết');
      const viewed = state.track.mock.calls.filter((c) => c[0] === 'cart_viewed');
      expect(viewed).toHaveLength(1);
      expect(viewed[0]![1]).toMatchObject({ itemCount: 1 });
    } finally {
      h.cleanup();
    }
  });

  it('cấu hình chưa có lúc dựng mà máy khách có món: hydrate không lệch (giỏ đọc qua hook, không đọc thẳng localStorage lúc vẽ)', async () => {
    const h = await hydrateWithLines(null, [{ variationId: 'v1', slug: 'dau-goi', quantity: 1 }]);
    try {
      expect(h.recoverable).toEqual([]);
      expect(h.hydrationLogs).toEqual([]);
    } finally {
      h.cleanup();
    }
  });
});

describe('/gio-hang — khách chưa đăng nhập, lời báo "Mua lại đơn này"', () => {
  it('có lời báo còn hạn: hiện một lần ở đầu giỏ khách (tên món và lý do), rồi xoá khỏi bộ nhớ', async () => {
    putGuestLines([{ variationId: 'v1', slug: 'dau-goi', quantity: 1 }]);
    sessionStorage.setItem(
      GUEST_REORDER_NOTE_KEY,
      JSON.stringify({ skipped: [{ name: 'Xà phòng thảo mộc (100g)', reason: 'OUT_OF_STOCK' }, { name: 'Nước lau sàn', reason: 'INACTIVE' }], at: Date.now() }),
    );
    const c = await mount(clientWith(true), (el) => !!el.querySelector('[data-testid="guest-reorder-note"]') && !!el.querySelector('[data-testid="guest-cart"]'));
    const note = c.querySelector('[data-testid="guest-reorder-note"]')!;
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toContain('2 món không thêm được vào giỏ:');
    expect(note.textContent).toContain('Xà phòng thảo mộc (100g) (hết hàng)');
    expect(note.textContent).toContain('Nước lau sàn (ngừng bán)');
    expect(sessionStorage.getItem(GUEST_REORDER_NOTE_KEY)).toBeNull();
  });

  it('không có lời báo: không có khối báo', async () => {
    putGuestLines([{ variationId: 'v1', slug: 'dau-goi', quantity: 1 }]);
    const c = await mount(clientWith(true), (el) => !!el.querySelector('[data-testid="cart-line"][data-state="ok"]'));
    expect(c.querySelector('[data-testid="guest-reorder-note"]')).toBeNull();
  });
});
