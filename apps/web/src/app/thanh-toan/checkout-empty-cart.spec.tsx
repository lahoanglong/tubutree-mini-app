// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// R3-UI-2: mở /thanh-toan khi giỏ trống (đặt xong rồi bấm Back, mở lại tab cũ) không dựng form thanh toán 0đ và
// không gọi /checkout/quote (400), mà báo giỏ trống kèm đường về trang sản phẩm.

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};

const m = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  quote: vi.fn(),
  cartGate: Promise.resolve() as Promise<void>,
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => {
    await m.cartGate;
    return { items: m.items, couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: m.items.length };
  },
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getAddresses: async () => [ADDR],
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  getPublicConfig: async () => ({ recyclingEnabled: false }),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.items = [];
  m.cartGate = Promise.resolve();
  m.quote.mockReset().mockResolvedValue({ subtotal: 0, discount: 0, shippingFee: 0, total: 0 });
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — giỏ trống (R3-UI-2)', () => {
  it('báo "Giỏ hàng đang trống" kèm nút về trang sản phẩm, không dựng form thanh toán, không gọi báo giá', async () => {
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(r.container.textContent).toContain('Giỏ hàng đang trống');
    const back = [...r.container.querySelectorAll('a')].find((a) => a.textContent?.includes('Khám phá sản phẩm'));
    expect(back?.getAttribute('href')).toBe('/');
    expect(r.container.textContent).not.toContain('Phương thức thanh toán');
    expect(r.container.textContent).not.toContain('Địa chỉ giao hàng');
    expect(r.container.querySelector('button')?.textContent ?? '').not.toContain('Đặt hàng');
    expect(m.quote).not.toHaveBeenCalled();
  });

  // R5-BUYER-5: địa chỉ về trước giỏ thì lúc đó giỏ chưa biết là trống hay không; báo giá sớm gặp 400 khi giỏ trống.
  it('địa chỉ về trước giỏ: chưa báo giá cho tới khi giỏ tải xong; giỏ trống thì không bao giờ báo giá', async () => {
    let release!: () => void;
    m.cartGate = new Promise<void>((r) => (release = r));
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(m.quote).not.toHaveBeenCalled();
    release();
    await flush(8);
    expect(r.container.textContent).toContain('Giỏ hàng đang trống');
    expect(m.quote).not.toHaveBeenCalled();
  });

  it('địa chỉ về trước giỏ, giỏ có hàng: báo giá đúng một lần sau khi giỏ về', async () => {
    m.items = [
      { id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 },
    ];
    m.quote.mockResolvedValue({ subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 });
    let release!: () => void;
    m.cartGate = new Promise<void>((r) => (release = r));
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(m.quote).not.toHaveBeenCalled();
    release();
    await flush(8);
    expect(m.quote).toHaveBeenCalledTimes(1);
  });

  it('giỏ có hàng vẫn dựng form và báo giá như cũ', async () => {
    m.items = [
      { id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 },
    ];
    m.quote.mockResolvedValue({ subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 });
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    expect(r.container.textContent).toContain('Phương thức thanh toán');
    expect(r.container.textContent).not.toContain('Giỏ hàng đang trống');
    expect(m.quote).toHaveBeenCalled();
  });
});
