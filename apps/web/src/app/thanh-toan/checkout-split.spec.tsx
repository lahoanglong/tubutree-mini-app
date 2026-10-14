// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
const SHOP = { kind: 'MERCHANT', storefrontId: 'sf1', name: 'Mật ong Linh' };
const BLOCK_REASON = 'Đơn gồm hàng do nhiều nơi giao nên chỉ thanh toán được khi nhận hàng (COD) hoặc bằng Ví Tubu.';
const QUOTE = {
  subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 55000, total: 355000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
  shipments: [
    { key: 'TUBU', fulfiller: TUBU, itemIds: ['t1'], subtotal: 100000, discount: 0, shippingFee: 30000, total: 130000 },
    { key: 'MERCHANT:sf1', fulfiller: SHOP, itemIds: ['m1'], subtotal: 200000, discount: 0, shippingFee: 25000, total: 225000 },
  ],
  blockedPaymentMethods: { BANK_TRANSFER: BLOCK_REASON },
};

const m = vi.hoisted(() => ({ quote: vi.fn(), placeOrder: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [
      { id: 't1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000, fulfiller: TUBU },
      { id: 'm1', variationId: 'v2', productName: 'Mật ong rừng', variationName: null, slug: 'mat-ong', thumbnail: null, unitPrice: 200000, quantity: 1, stock: 5, total: 200000, fulfiller: SHOP },
    ],
    couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 2,
  }),
  getMyCoupons: async () => [],
  getAddresses: async () => [ADDR],
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
  getPublicConfig: async () => ({ recyclingEnabled: false }),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const radio = (r: Rendered, label: string) =>
  [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!;

beforeEach(() => {
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.placeOrder.mockReset();
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — tách đơn theo nơi giao (D4)', () => {
  it('tóm tắt chia theo nơi giao kèm phí giao từng kiện; báo sẽ thành 2 đơn', async () => {
    const r = await mount();
    const region = r.container.querySelector('[aria-label="Sản phẩm trong đơn"]')!;
    expect(region.textContent).toContain('Tubu Tree giao');
    expect(region.textContent).toContain('Mật ong Linh giao');
    expect(region.textContent).toMatch(/Phí giao\s*30\.000/);
    expect(region.textContent).toMatch(/Phí giao\s*25\.000/);
    expect(r.container.textContent).toContain('sẽ thành 2 đơn riêng');
  });

  it('R2-MERCHANT-8: giỏ tách kiện không bị khung cuộn cao cố định giấu kiện thứ ba', async () => {
    const r = await mount();
    const region = r.container.querySelector<HTMLElement>('[aria-label="Sản phẩm trong đơn"]')!;
    expect(region.className).not.toContain('max-h-');
    expect(region.className).not.toContain('overflow-auto');
    expect(region.hasAttribute('tabindex')).toBe(false);
  });

  it('chuyển khoản bị khoá kèm lý do từ BE; đặt hàng gửi COD', async () => {
    m.placeOrder.mockReturnValue(new Promise(() => undefined));
    const r = await mount();
    const bank = radio(r, 'Chuyển khoản ngân hàng');
    expect(bank.disabled).toBe(true);
    expect(r.container.querySelector(`#${bank.getAttribute('aria-describedby')}`)!.textContent).toBe(BLOCK_REASON);
    click([...r.container.querySelectorAll('button')].find((b) => b.textContent === 'Đặt hàng')!);
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0]).toMatchObject({ paymentMethod: 'COD' });
  });

  it('đặt xong: liệt kê từng đơn con với nơi giao, tổng và liên kết chi tiết', async () => {
    m.placeOrder.mockResolvedValue({
      code: 'TB1', status: 'CONFIRMED', subtotal: 100000, discount: 0, shippingFee: 30000, total: 130000, paymentMethod: 'COD', createdAt: '2026-10-14T00:00:00Z', items: [],
      splitOrders: [
        { id: 'o1', code: 'TB1', total: 130000, status: 'CONFIRMED', fulfiller: 'TUBU', fulfillerName: 'Tubu Tree' },
        { id: 'o2', code: 'TB2', total: 225000, status: 'CONFIRMED', fulfiller: 'MERCHANT', fulfillerName: 'Mật ong Linh' },
      ],
    });
    const r = await mount();
    click([...r.container.querySelectorAll('button')].find((b) => b.textContent === 'Đặt hàng')!);
    await flush(8);
    const items = [...r.container.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual([expect.stringContaining('TB1 · Tubu Tree giao'), expect.stringContaining('TB2 · Mật ong Linh giao')]);
    expect(items[1]).toContain('225.000');
    expect(r.container.querySelector('a[href*="TB2"]')).not.toBeNull();
  });
});
