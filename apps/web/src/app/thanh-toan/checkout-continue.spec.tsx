// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// "Tiếp tục mua sắm" sau khi đặt xong: web chỉ có StorefrontTracker ở /s/[slug], nên slug trong ngữ cảnh luôn là của /s/, không bao giờ của /brand/.

const m = vi.hoisted(() => ({ replace: vi.fn(), ctx: { slug: null as string | null, referralCode: null as string | null, kind: null as string | null } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: m.replace, push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/storefront-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storefront-context')>()),
  getStorefrontContext: () => m.ctx,
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }],
    couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  }),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getAddresses: async () => [
    { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true },
  ],
  checkoutQuote: async () => ({ subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 }),
  placeOrder: async () => ({
    id: 'o1', code: 'TB1', status: 'CONFIRMED', subtotal: 100000, discount: 0, shippingFee: 30000, total: 130000, paymentMethod: 'COD', createdAt: '2026-10-14T00:00:00Z', items: [],
  }),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.replace.mockReset();
});

const continueAfterOrder = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  click(byText(r.container, 'button', 'Đặt hàng'));
  await flush(8);
  click(byText(r.container.querySelector<HTMLElement>('[data-testid="order-success-mobile"]')!, 'button', 'Tiếp tục mua sắm'));
};

describe('/thanh-toan — Tiếp tục mua sắm sau khi đặt xong', () => {
  it.each([['MERCHANT'], ['BRAND'], [null], ['CTV']])('đang ở gian hàng /s/acme (kind %s) → về /s/acme, không bao giờ /brand/', async (kind) => {
    m.ctx = { slug: 'acme', referralCode: null, kind };
    await continueAfterOrder();
    expect(m.replace).toHaveBeenLastCalledWith('/s/acme');
  });

  it('không có gian hàng → về trang chủ', async () => {
    m.ctx = { slug: null, referralCode: null, kind: null };
    await continueAfterOrder();
    expect(m.replace).toHaveBeenLastCalledWith('/');
  });

  it('màn thành công ở điện thoại không còn data-page-bleed (giữ đệm 48px của nút lùi như Mini App)', async () => {
    m.ctx = { slug: null, referralCode: null, kind: null };
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    click(byText(r.container, 'button', 'Đặt hàng'));
    await flush(8);
    expect(r.container.querySelector('[data-testid="order-success-mobile"]')).not.toBeNull();
    expect(r.container.querySelector('[data-page-bleed]')).toBeNull();
  });
});
