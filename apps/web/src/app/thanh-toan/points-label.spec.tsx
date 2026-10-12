// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Nhãn ô "dùng Điểm Xanh" phải khớp số điểm backend thật sự trừ (đã áp trần % giá trị hàng), không phải
// số dư: khách 500 điểm thường, hàng 100.000đ, trần 20% → trừ 20 điểm chứ không phải 500.

const SUBTOTAL = 100000;
const calls = vi.hoisted(() => ({ pointsToUse: [] as number[] }));

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
  checkoutQuote: async (_addr: string, pointsToUse: number) => {
    calls.pointsToUse.push(pointsToUse);
    const used = pointsToUse > 0 ? 20 : 0;
    return {
      subtotal: SUBTOTAL, discount: 0, pointsUsed: used, pointsDiscount: used * 1000, shippingFee: 30000,
      total: SUBTOTAL - used * 1000 + 30000, pointsEarned: 0, pointsBalance: 500, redeemablePoints: 500,
    };
  },
  getPublicConfig: async () => ({ recyclingEnabled: false }),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  calls.pointsToUse = [];
});

describe('/thanh-toan — nhãn dùng Điểm Xanh', () => {
  it('chưa tick: "Bạn có 500 Điểm Xanh"; tick xong: đúng 20 điểm thật trừ, không còn ghi 500', async () => {
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    const label = () => r.container.querySelector('label:has(input[type="checkbox"])')!.textContent ?? '';
    expect(label()).toContain('Bạn có 500 Điểm Xanh');

    click(r.container.querySelector<HTMLInputElement>('label input[type="checkbox"]')!);
    await flush(8);
    expect(calls.pointsToUse).toContain(500);
    expect(label()).toContain('Dùng 20 Điểm Xanh — giảm 20.000đ');
    expect(label()).not.toContain('500');
  });
});
