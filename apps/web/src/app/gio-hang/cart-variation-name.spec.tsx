// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Phân loại không đặt tên (86/154 phân loại trên PROD): dòng giỏ không dựng dòng phân loại trống, danh sách "đã ngừng bán" không treo dấu " · ".

const state = vi.hoisted(() => ({ cart: null as unknown }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/gio-hang' }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => state.cart,
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  getCartSelection: async () => {
    throw new Error('chưa mock');
  },
}));

import CartPage from './page';

const line = (over: Record<string, unknown>) => ({
  id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết', variationName: '500ml', slug: 'dau-goi', thumbnail: null,
  unitPrice: 150000, quantity: 1, stock: 5, total: 150000, ...over,
});
const cartOf = (items: unknown[], unavailableItems: unknown[] = []) => ({
  items, unavailableItems, couponCode: null, subtotal: 150000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: items.length,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CartPage />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const cartLine = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="cart-line"]')!;
const textRows = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLElement>('div.basis-full'));

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/gio-hang — phân loại không có tên', () => {
  it('có tên: dòng phân loại hiện dưới tên sản phẩm như trước', async () => {
    state.cart = cartOf([line({})]);
    const rows = textRows(cartLine(await mount()));
    expect(rows.map((r) => r.textContent)).toEqual(['Dầu gội bồ kết', '500ml']);
  });

  it('tên trống hoặc toàn khoảng trắng: không dựng dòng phân loại (không hàng chữ trống)', async () => {
    for (const variationName of ['', '   ']) {
      state.cart = cartOf([line({ variationName })]);
      const c = await mount();
      expect(textRows(cartLine(c)).map((r) => r.textContent)).toEqual(['Dầu gội bồ kết']);
      mounted.forEach((m) => m.unmount());
      mounted = [];
    }
  });

  it('danh sách "đã ngừng bán": tên trống thì chỉ "Tên × SL", không " · " treo; có tên giữ "Tên · phân loại × SL"', async () => {
    state.cart = cartOf(
      [line({})],
      [
        { id: 'u1', productName: 'Dầu gội bồ kết', variationName: '', quantity: 2 },
        { id: 'u2', productName: 'Dầu xả', variationName: '  ', quantity: 1 },
        { id: 'u3', productName: 'Sữa tắm', variationName: '250ml', quantity: 3 },
      ],
    );
    const c = await mount();
    const texts = Array.from(c.querySelectorAll<HTMLElement>('[role="status"] li span.line-through')).map((s) => s.textContent);
    expect(texts).toEqual(['Dầu gội bồ kết × 2', 'Dầu xả × 1', 'Sữa tắm · 250ml × 3']);
  });
});
