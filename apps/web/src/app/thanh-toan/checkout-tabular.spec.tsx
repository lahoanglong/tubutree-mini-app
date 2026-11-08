// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// W52B: số tiền và số lượng ở khung "Đơn hàng" từ lg dùng số đều (tabular-nums) như khối tổng của điện thoại và Mini App,
// để cột số không nhảy khi giá đổi.

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
const SHOP = { kind: 'MERCHANT', storefrontId: 'sf1', name: 'Mật ong Linh' };
const QUOTE = {
  subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 55000, total: 355000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
  shipments: [
    { key: 'TUBU', fulfiller: TUBU, itemIds: ['t1'], subtotal: 100000, discount: 0, shippingFee: 0, total: 100000 },
    { key: 'MERCHANT:sf1', fulfiller: SHOP, itemIds: ['m1'], subtotal: 200000, discount: 0, shippingFee: 25000, total: 225000 },
  ],
  blockedPaymentMethods: {},
};
const TUBU_LINE = { id: 't1', variationId: 'v1', productName: 'Dầu gội', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 50000, quantity: 2, stock: 5, total: 100000, fulfiller: TUBU };
const SHOP_LINE = { id: 'm1', variationId: 'v2', productName: 'Mật ong rừng', variationName: null, slug: 'mat-ong', thumbnail: null, unitPrice: 200000, quantity: 1, stock: 5, total: 200000, fulfiller: SHOP };
const CART = { items: [TUBU_LINE, SHOP_LINE], couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 3 };

const m = vi.hoisted(() => ({ quote: vi.fn(), cart: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: (...args: unknown[]) => m.cart(...args),
  getMyCoupons: async () => [],
  getAddresses: async () => [ADDR],
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
/** Phần tử giá trị đứng ngay sau nhãn có chữ đúng bằng `label` trong `root`. */
const valueOf = (root: ParentNode, label: string) => {
  const key = [...root.querySelectorAll('span')].find((s) => s.textContent === label);
  return key?.nextElementSibling as HTMLElement | null | undefined;
};

beforeEach(() => {
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.cart.mockReset().mockResolvedValue(CART);
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — số đều ở khung Đơn hàng từ lg (W52B)', () => {
  it('dòng Tổng cộng trong khối dính place-order dùng tabular-nums', async () => {
    const c = await mount();
    const part = c.querySelector<HTMLElement>('[data-mini-part="place-order"]')!;
    const total = valueOf(part, 'Tổng cộng');
    expect(total).toBeTruthy();
    expect(total!.textContent).toMatch(/355\.000/);
    expect(total!.classList.contains('tabular-nums')).toBe(true);
  });

  it('dòng Phí giao của từng kiện dùng tabular-nums, kể cả chữ "Miễn phí"', async () => {
    const c = await mount();
    const region = c.querySelector('[aria-label="Sản phẩm trong đơn"]')!;
    const fees = [...region.querySelectorAll('span')].filter((s) => s.textContent === 'Phí giao').map((s) => s.nextElementSibling as HTMLElement);
    expect(fees.map((f) => f.textContent)).toEqual(['Miễn phí', expect.stringMatching(/25\.000/)]);
    for (const f of fees) expect(f.classList.contains('tabular-nums')).toBe(true);
  });

  it('chú thích ×số lượng của từng dòng hàng dùng tabular-nums', async () => {
    const c = await mount();
    const region = c.querySelector('[aria-label="Sản phẩm trong đơn"]')!;
    const captions = [...region.querySelectorAll('[data-testid="checkout-line"] span.block')];
    expect(captions.map((s) => s.textContent)).toEqual(['500ml · ×2', '×1']);
    for (const s of captions) expect(s.classList.contains('tabular-nums')).toBe(true);
  });
});
