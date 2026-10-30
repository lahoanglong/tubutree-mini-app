// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Hoa hồng đơn trả hàng bị thu hồi có thể kéo Ví CTV xuống âm: dòng Ví vẫn hiện (khoá, kèm lý do) để khách biết vì sao.

const walletBalance = vi.hoisted(() => ({ value: 0 }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }],
    couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  }),
  getMe: async () => ({ pointsBalance: 0, walletBalance: walletBalance.value }),
  getMyCoupons: async () => [],
  getAddresses: async () => [
    { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: 'p', districtCode: '', wardCode: 'w', isDefault: true },
  ],
  checkoutQuote: async () => ({
    subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
  }),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};

const walletRadio = (r: Rendered) => r.container.querySelector<HTMLInputElement>('input[name="pay"][aria-describedby="pay-blocked-WALLET"]');

describe('/thanh-toan — Ví đang âm', () => {
  it('Ví âm: dòng Ví hiện số âm đúng dấu, bị khoá, lý do nói rõ số âm và cách xử lý', async () => {
    walletBalance.value = -50000;
    const r = await mount();
    expect(r.container.textContent).toContain('Ví Tubu (-50.000đ)');
    expect(walletRadio(r)?.disabled).toBe(true);
    expect(r.container.querySelector('#pay-blocked-WALLET')?.textContent).toMatch(/Ví đang âm 50\.000đ do thu hồi hoa hồng đơn trả hàng/);
  });

  it('Ví 0đ: không hiện dòng Ví (như cũ)', async () => {
    walletBalance.value = 0;
    const r = await mount();
    expect(r.container.textContent).not.toContain('Ví Tubu (');
  });
});
