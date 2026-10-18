// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Tóm tắt tiền phải cộng ra đúng tổng: ngoài mã và Điểm Xanh, API báo thêm ưu đãi combo và ưu đãi hạng thành viên.

const SUBTOTAL = 200000;
const calls = vi.hoisted(() => ({ extra: {} as Record<string, unknown> }));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [
      { id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: SUBTOTAL, quantity: 1, stock: 5, total: SUBTOTAL },
    ],
    couponCode: null, subtotal: SUBTOTAL, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  }),
  getMyCoupons: async () => [],
  getAddresses: async () => [
    { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: 'p', districtCode: '', wardCode: 'w', isDefault: true },
  ],
  checkoutQuote: async () => ({
    subtotal: SUBTOTAL, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000,
    total: SUBTOTAL + 30000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
    ...calls.extra,
  }),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  calls.extra = {};
});

const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};

describe('/thanh-toan — dòng ưu đãi combo và hạng thành viên', () => {
  it('quote có combo và hạng → hiện hai dòng với đúng số tiền', async () => {
    calls.extra = { comboDiscount: 30000, tierDiscount: 10000, total: SUBTOTAL - 40000 + 30000 };
    const r = await mount();
    const text = r.container.textContent ?? '';
    expect(text).toContain('Ưu đãi combo');
    expect(text).toContain('-30.000đ');
    expect(text).toContain('Ưu đãi hạng thành viên');
    expect(text).toContain('-10.000đ');
  });

  it('combo/hạng bằng 0 hoặc API cũ không trả → không hiện dòng nào', async () => {
    calls.extra = { comboDiscount: 0 };
    const r = await mount();
    expect(r.container.textContent).not.toContain('Ưu đãi combo');
    expect(r.container.textContent).not.toContain('Ưu đãi hạng thành viên');
  });
});
