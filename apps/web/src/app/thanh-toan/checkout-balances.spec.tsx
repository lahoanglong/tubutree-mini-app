// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Khoá việc đặt đơn thành công làm mới số dư: trang Tài khoản tự lấy lại /me nên e2e không bắt được khi bỏ lời gọi,
// nhưng ví, sổ ví và sổ Điểm Xanh sẽ còn số cũ.

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
const QUOTE = {
  subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
  shipments: [{ key: 'TUBU', fulfiller: TUBU, itemIds: ['t1'], subtotal: 100000, discount: 0, shippingFee: 30000, total: 130000 }],
  blockedPaymentMethods: {},
};
const LINE = { id: 't1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000, fulfiller: TUBU };
const CART = { items: [LINE], couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1 };
const ORDER = { code: 'TB1', status: 'CONFIRMED', subtotal: 100000, discount: 0, shippingFee: 30000, total: 130000, paymentMethod: 'COD', createdAt: '2026-10-14T00:00:00Z', items: [] };

const m = vi.hoisted(() => ({ placeOrder: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => CART,
  getMyCoupons: async () => [],
  getAddresses: async () => [ADDR],
  checkoutQuote: async () => QUOTE,
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const invalidated = () => vi.spyOn(QueryClient.prototype, 'invalidateQueries');

beforeEach(() => m.placeOrder.mockReset());
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
  vi.restoreAllMocks();
});

describe('/thanh-toan — đặt đơn xong làm mới số dư', () => {
  it('đơn thành công làm mới me, wallet, wallet-txn và points-txn', async () => {
    m.placeOrder.mockResolvedValue(ORDER);
    const spy = invalidated();
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    spy.mockClear();
    click([...r.container.querySelectorAll('button')].find((b) => b.textContent === 'Đặt hàng')!);
    await flush(8);
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(['me', 'wallet', 'wallet-txn', 'points-txn']));
  });

  it('đơn lỗi thì không làm mới số dư', async () => {
    m.placeOrder.mockRejectedValue(new Error('hết hàng'));
    const spy = invalidated();
    const r = render(<CheckoutPage />);
    mounted.push(r);
    await flush(8);
    spy.mockClear();
    click([...r.container.querySelectorAll('button')].find((b) => b.textContent === 'Đặt hàng')!);
    await flush(8);
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(keys).not.toContain('wallet');
    expect(keys).not.toContain('points-txn');
  });
});
