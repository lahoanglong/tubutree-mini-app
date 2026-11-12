// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Phân loại không đặt tên (86/154 phân loại trên PROD): cả hai danh sách hàng của màn thanh toán không dựng chữ phân loại trống, không treo dấu " · " trước "×SL".

const mocks = vi.hoisted(() => ({ variationName: 'Can 5 lít' as string | null }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Nước rửa chén', variationName: mocks.variationName, slug: 'sp-1', thumbnail: null, unitPrice: 10_000, quantity: 2, stock: 9, total: 20_000 }],
    couponCode: null, subtotal: 20_000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 2,
  }),
  getMyCoupons: async () => [],
  getAddresses: async () => [
    { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: 'p', districtCode: '', wardCode: 'w', isDefault: true },
  ],
  checkoutQuote: async () => ({
    subtotal: 20_000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000,
    total: 50_000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
  }),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  mocks.variationName = 'Can 5 lít';
});

const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const wideRow = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="region"][aria-label="Sản phẩm trong đơn"] [data-testid="checkout-line"]')!;
const wideCaption = (c: HTMLElement) => wideRow(c).querySelector<HTMLElement>('span.block')!.textContent;
const phoneCaptions = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('section[aria-label="Sản phẩm sẽ mua"] div.text-caption')).map((d) => d.textContent);

describe('/thanh-toan — phân loại không có tên', () => {
  it('có tên: khung Đơn hàng ghi "phân loại · ×SL", danh sách điện thoại có dòng phân loại riêng', async () => {
    const c = await mount();
    expect(wideCaption(c)).toBe('Can 5 lít · ×2');
    expect(phoneCaptions(c)).toEqual(['Can 5 lít', '10.000đ × 2']);
  });

  it('tên trống, toàn khoảng trắng hay null: chỉ "×SL" (không " · " treo) và không dòng phân loại trống ở danh sách điện thoại', async () => {
    for (const name of ['', '   ', null]) {
      mocks.variationName = name;
      const c = await mount();
      expect(wideCaption(c)).toBe('×2');
      expect(wideRow(c).textContent).not.toContain('·');
      expect(phoneCaptions(c)).toEqual(['10.000đ × 2']);
      mounted.forEach((m) => m.unmount());
      mounted = [];
    }
  });
});
