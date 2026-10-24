// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Như Mini App: dòng hết hàng (tồn 0) đang chọn không cộng vào tạm tính hay tiến độ miễn phí giao.

const state = vi.hoisted(() => ({ cart: null as unknown }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
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
// Máy chủ tính freeship/subtotal trên cả giỏ kể cả dòng hết hàng.
const cartOf = (items: unknown[]) => ({
  items, couponCode: null, subtotal: 500000, discount: 0, freeship: true, freeshipThreshold: 500000, itemCount: 2,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CartPage />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const bar = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="sticky-bar"]')!;

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/gio-hang — dòng hết hàng không tính vào tạm tính và freeship', () => {
  it('chọn cả giỏ có dòng hết hàng 150.000đ: tạm tính chỉ phần còn hàng, không báo đủ miễn phí giao dù máy chủ báo freeship', async () => {
    state.cart = cartOf([line({ id: 'a', total: 350000, quantity: 2, unitPrice: 175000 }), line({ id: 'b', productName: 'Hết hàng', stock: 0 })]);
    const b = bar(await mount()).textContent!;
    expect(b).toContain('350.000đ');
    expect(b).not.toContain('500.000đ');
    expect(b).not.toContain('Bạn được miễn phí giao hàng');
    expect(b).toContain('Mua thêm 150.000đ để được miễn phí giao hàng');
  });

  it('không có dòng hết hàng: giữ nguyên, freeship của máy chủ vẫn được tin', async () => {
    state.cart = cartOf([line({ id: 'a', total: 500000, quantity: 2, unitPrice: 250000 })]);
    const b = bar(await mount()).textContent!;
    expect(b).toContain('Bạn được miễn phí giao hàng');
    expect(b).toContain('500.000đ');
  });
});
