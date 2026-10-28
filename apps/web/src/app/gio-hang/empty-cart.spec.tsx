// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Giỏ trống ở khổ điện thoại phải như Mini App (apps/miniapp/src/pages/cart.tsx): minh hoạ + "Giỏ còn trống đấy" + nút
// "Khám phá ngay", rồi kệ "Có thể bạn thích" để khách có chỗ đi tiếp.

const m = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push, replace: vi.fn() }), usePathname: () => '/gio-hang' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({ items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 0 }),
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  getCartSelection: async () => {
    throw new Error('chưa mock');
  },
}));

import CartPage from './page';

const product = (id: string, over: Record<string, unknown> = {}) => ({
  id, slug: `sp-${id}`, brand: 'Tubu', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true, ...over,
});

let rail: unknown[] = [];
let railFails = false;
let calls: URL[] = [];

beforeEach(() => {
  m.push.mockReset();
  rail = [product('a'), product('b'), product('c'), product('d')];
  railFails = false;
  calls = [];
  sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url);
      calls.push(u);
      if (u.pathname.endsWith('/products')) {
        if (railFails) return new Response(JSON.stringify({ message: 'x' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify({ data: rail, meta: { page: 1, limit: 4, total: rail.length } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.pathname.includes('/wishlist')) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CartPage />);
  mounted.push(r);
  // EmptyCart là chunk tải lười: đợi tới khi nó hiện (bản vitest dịch lần đầu chậm hơn vài lượt).
  for (let i = 0; i < 100 && !r.container.textContent?.includes('Giỏ còn trống đấy'); i++) await flush(1);
  await flush(6);
  return r.container;
};
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('/gio-hang — giỏ trống như Mini App', () => {
  it('chữ và nút như Mini App: "Giỏ còn trống đấy", mô tả, nút "Khám phá ngay"', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Giỏ còn trống đấy');
    expect(c.textContent).toContain('Khám phá sản phẩm Tubu chọn riêng cho bạn');
    const cta = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Khám phá ngay');
    expect(cta).toBeTruthy();
    expect(c.textContent).not.toContain('Giỏ hàng đang trống');
  });

  it('bấm "Khám phá ngay" sang /san-pham', async () => {
    const c = await mount();
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Khám phá ngay')!);
    expect(m.push).toHaveBeenCalledWith('/san-pham');
  });

  it('có kệ "Có thể bạn thích" với 4 thẻ sản phẩm', async () => {
    const c = await mount();
    const sec = c.querySelector('section[aria-label="Có thể bạn thích"]')!;
    expect(sec).not.toBeNull();
    expect(sec.querySelector('h2')!.textContent).toBe('Có thể bạn thích');
    expect(sec.querySelectorAll('a[href^="/san-pham/"]').length).toBeGreaterThanOrEqual(4);
    const req = calls.find((u) => u.pathname.endsWith('/products'))!;
    expect(req.searchParams.get('limit')).toBe('4');
    expect(req.searchParams.get('sort')).toBe('best_seller');
  });

  it('bỏ sản phẩm hết hàng khỏi kệ', async () => {
    rail = [product('a'), product('b', { inStock: false }), product('c')];
    const c = await mount();
    const sec = c.querySelector('section[aria-label="Có thể bạn thích"]')!;
    expect(sec.textContent).toContain('Sản phẩm a');
    expect(sec.textContent).toContain('Sản phẩm c');
    expect(sec.textContent).not.toContain('Sản phẩm b');
  });

  it('toàn hàng hết hoặc lỗi tải: không vẽ kệ, màn trống vẫn còn nút', async () => {
    rail = [product('a', { inStock: false })];
    let c = await mount();
    expect(c.querySelector('section[aria-label="Có thể bạn thích"]')).toBeNull();
    expect(c.textContent).toContain('Giỏ còn trống đấy');
    mounted.forEach((x) => x.unmount());
    mounted = [];
    railFails = true;
    c = await mount();
    expect(c.querySelector('section[aria-label="Có thể bạn thích"]')).toBeNull();
    expect(c.textContent).toContain('Giỏ còn trống đấy');
  });
});
