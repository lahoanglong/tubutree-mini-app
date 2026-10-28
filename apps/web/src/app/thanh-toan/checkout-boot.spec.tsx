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
const never = () => new Promise<never>(() => undefined);

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
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

describe('/thanh-toan — khung chờ và lỗi tải (R-7, R-22)', () => {
  it('giỏ chưa về: chỉ có khung chờ, chưa có khối Phương thức thanh toán, Ghi chú hay nút Đặt hàng', async () => {
    m.cart.mockImplementation(never);
    const r = await mount();
    expect(r.container.querySelector('[data-testid="checkout-skeleton"]')).not.toBeNull();
    expect(r.container.textContent).not.toContain('Phương thức thanh toán');
    expect(byText(r.container, 'button', 'Đặt hàng')).toBeFalsy();
  });

  it('báo giá chưa về: vẫn khung chờ, về rồi mới hiện đủ khối', async () => {
    m.quote.mockImplementation(never);
    const r = await mount();
    expect(r.container.querySelector('[data-testid="checkout-skeleton"]')).not.toBeNull();
  });

  it('có đủ giỏ, địa chỉ, báo giá: không còn khung chờ', async () => {
    const r = await mount();
    expect(r.container.querySelector('[data-testid="checkout-skeleton"]')).toBeNull();
    expect(r.container.textContent).toContain('Phương thức thanh toán');
  });

  it('giỏ lỗi: khối lỗi kèm Thử lại, không hiện "Tạm tính 0đ" hay nút Đặt hàng', async () => {
    m.cart.mockRejectedValue(new Error('boom'));
    const r = await mount();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Không tải được giỏ hàng.');
    expect(byText(r.container, 'button', 'Thử lại')).toBeTruthy();
    expect(r.container.textContent).not.toContain('Tạm tính');
    expect(byText(r.container, 'button', 'Đặt hàng')).toBeFalsy();
  });

  it('báo giá lỗi: ghi lý do ngay trên thanh Đặt hàng', async () => {
    m.quote.mockRejectedValue(new Error('boom'));
    const r = await mount();
    expect(r.container.textContent).toContain('Chưa tính được tổng tiền');
  });
});
