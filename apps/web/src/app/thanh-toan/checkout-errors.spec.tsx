// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };

const m = vi.hoisted(() => ({ quote: vi.fn(), placeOrder: vi.fn(), cart: vi.fn() }));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: (...args: unknown[]) => m.cart(...args),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getAddresses: async () => [ADDR],
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const placeButton = (r: Rendered) => byText(r.container, 'button', 'Đặt hàng') as HTMLButtonElement;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.placeOrder.mockReset();
  m.cart.mockReset().mockResolvedValue({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }],
    couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  });
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — lỗi đặt đơn như Mini App', () => {
  it('PRICE_CHANGED (hết suất/hết giờ vàng): báo bằng câu dễ hiểu, kèm đường về giỏ, tải lại giỏ và báo giá — không lộ mã lỗi', async () => {
    m.placeOrder.mockRejectedValue(new ApiError('PRICE_CHANGED', 400));
    const r = await mount();
    const carts = m.cart.mock.calls.length;
    const quotes = m.quote.mock.calls.length;
    click(placeButton(r));
    await flush(8);
    const alert = r.container.querySelector('[data-testid="checkout-price-changed"]')!;
    expect(alert.textContent).toContain('Giá ưu đãi đã thay đổi');
    expect(alert.textContent).toContain('Một số sản phẩm giờ vàng đã hết suất hoặc hết giờ. Vui lòng xem lại giỏ hàng trước khi đặt.');
    expect(alert.querySelector('a')!.getAttribute('href')).toBe('/gio-hang');
    expect(alert.querySelector('a')!.textContent).toBe('Xem lại giỏ hàng');
    expect(r.container.textContent).not.toContain('PRICE_CHANGED');
    expect(m.cart.mock.calls.length).toBeGreaterThan(carts);
    expect(m.quote.mock.calls.length).toBeGreaterThan(quotes);
  });

  it('CART_CHANGED (giỏ vừa đổi ở tab khác): giữ câu của máy chủ và tải lại giỏ, báo giá, đơn', async () => {
    const message = 'Giỏ hàng vừa thay đổi. Vui lòng kiểm tra lại trước khi đặt.';
    m.placeOrder.mockRejectedValue(new ApiError(message, 400, 'CART_CHANGED'));
    const r = await mount();
    const carts = m.cart.mock.calls.length;
    const quotes = m.quote.mock.calls.length;
    click(placeButton(r));
    await flush(8);
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(m.cart.mock.calls.length).toBeGreaterThan(carts);
    expect(m.quote.mock.calls.length).toBeGreaterThan(quotes);
  });
});
