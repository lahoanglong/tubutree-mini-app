// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const line = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, variationId: `v-${id}`, productName: name, variationName: null, slug: id, thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000, ...over,
});
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };

const m = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  quote: vi.fn(),
  cart: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
}));

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
  placeOrder: vi.fn(),
  updateCartItem: (...args: unknown[]) => m.updateCartItem(...args),
  removeCartItem: (...args: unknown[]) => m.removeCartItem(...args),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const problems = (r: Rendered) => Array.from(r.container.querySelectorAll('[data-testid="checkout-line-problem"]'));
const placeButton = (r: Rendered) => byText(r.container, 'button', 'Đặt hàng') as HTMLButtonElement;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.updateCartItem.mockReset().mockResolvedValue({});
  m.removeCartItem.mockReset().mockResolvedValue({});
  m.items = [];
  m.cart.mockReset().mockImplementation(async () => ({
    items: m.items, couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: m.items.length,
  }));
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — lỗi theo từng dòng hàng (hk)', () => {
  it('dòng vượt tồn: chữ "Còn 2 sản phẩm" ngay dưới dòng, nút "Giảm còn 2" sửa tại màn rồi tải lại giỏ và báo giá', async () => {
    m.items = [line('i1', 'Dầu gội', { quantity: 4, stock: 2 })];
    const r = await mount();
    expect(problems(r).length).toBeGreaterThan(0);
    expect(problems(r)[0]!.textContent).toContain('Còn 2 sản phẩm');
    expect(r.container.querySelector('[data-testid="checkout-cart-issue"]')).toBeNull();
    expect(placeButton(r).disabled).toBe(true);
    const carts = m.cart.mock.calls.length;
    const quotes = m.quote.mock.calls.length;
    click(byText(problems(r)[0]!, 'button', 'Giảm còn 2')!);
    await flush(8);
    expect(m.updateCartItem).toHaveBeenCalledWith('i1', 2);
    expect(m.cart.mock.calls.length).toBeGreaterThan(carts);
    expect(m.quote.mock.calls.length).toBeGreaterThan(quotes);
  });

  it('dòng hết hàng: "Hết hàng" và "Bỏ khỏi đơn" gọi removeCartItem đúng dòng; dòng còn hàng không có nút sửa', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 }), line('i2', 'Mật ong')];
    const r = await mount();
    const first = problems(r)[0]!;
    expect(first.textContent).toContain('Hết hàng');
    expect(new Set(problems(r).map((p) => p.textContent)).size).toBe(1);
    click(byText(first, 'button', 'Bỏ khỏi đơn')!);
    await flush(8);
    expect(m.removeCartItem).toHaveBeenCalledWith('i1');
    expect(m.updateCartItem).not.toHaveBeenCalled();
  });

  it('sửa nhanh bị máy chủ từ chối: câu lỗi hiện ngay dòng đó, không mất dòng', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 })];
    m.removeCartItem.mockRejectedValue(new ApiError('Giỏ hàng không còn sản phẩm này.', 404));
    const r = await mount();
    click(byText(problems(r)[0]!, 'button', 'Bỏ khỏi đơn')!);
    await flush(8);
    expect(problems(r)[0]!.textContent).toContain('Giỏ hàng không còn sản phẩm này.');
  });

  it('còn dòng cần sửa: ghi lý do khoá nút ở dải đáy', async () => {
    m.items = [line('i1', 'Dầu gội', { stock: 0 })];
    const r = await mount();
    expect(r.container.textContent).toContain('Sửa sản phẩm đang báo lỗi để đặt tiếp.');
  });

  it('dòng lỗi nằm sau dòng thứ 6: danh sách trong khung Đơn hàng tự mở ra để thấy dòng lỗi', async () => {
    m.items = [1, 2, 3, 4, 5, 6, 7].map((n) => line(`i${n}`, `Món ${n}`, n === 7 ? { stock: 0 } : {}));
    const r = await mount();
    const region = r.container.querySelector('[role="region"][aria-label="Sản phẩm trong đơn"]')!;
    expect(region.querySelectorAll('[data-testid="checkout-line"]')).toHaveLength(7);
    expect(region.querySelector('[data-testid="checkout-line-problem"]')).not.toBeNull();
  });
});
