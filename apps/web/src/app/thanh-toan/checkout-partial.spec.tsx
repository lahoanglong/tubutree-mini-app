// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { QueryClient } from '@tanstack/react-query';
import { recallCheckoutSelection, rememberCheckoutSelection } from '@/lib/checkout-selection';
import { NetworkError } from '@/lib/client-api';

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
  place: vi.fn(),
  removeCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: m.replace, push: m.push }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: (...args: unknown[]) => m.cart(...args),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getAddresses: async () => [ADDR],
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  placeOrder: (...args: unknown[]) => m.place(...args),
  removeCartItem: (...args: unknown[]) => m.removeCartItem(...args),
  updateCartItem: (...args: unknown[]) => m.updateCartItem(...args),
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
const quoteItemIds = () => m.quote.mock.calls.map((c) => c[3]);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.place.mockReset();
  m.removeCartItem.mockReset().mockResolvedValue({});
  m.updateCartItem.mockReset().mockResolvedValue({});
  m.replace.mockReset();
  m.push.mockReset();
  m.items = [];
  m.cart.mockReset().mockImplementation(async () => ({
    items: m.items, couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: m.items.length,
  }));
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — thanh toán một phần giỏ: dòng chọn cuối cùng và lựa chọn đã chết (hk)', () => {
  it('dòng hết hàng là dòng DUY NHẤT được chọn: nút là "Về giỏ hàng", không xoá tại màn (xoá thì lựa chọn rỗng và màn chuyển sang cả giỏ)', async () => {
    rememberCheckoutSelection(['A']);
    m.items = [line('A', 'Dầu gội', { stock: 0 }), line('B', 'Mật ong'), line('C', 'Xà bông')];
    const r = await mount();
    const first = problems(r)[0]!;
    expect(byText(first, 'button', 'Bỏ khỏi đơn')).toBeNull();
    click(byText(first, 'button', 'Về giỏ hàng')!);
    await flush(4);
    expect(m.push).toHaveBeenCalledWith('/gio-hang');
    expect(m.removeCartItem).not.toHaveBeenCalled();
    expect(r.container.textContent).not.toContain('Mật ong');
    expect(quoteItemIds().every((ids) => JSON.stringify(ids) === JSON.stringify(['A']))).toBe(true);
  });

  it('được chọn từ hai dòng: dòng hết hàng vẫn bỏ được tại màn', async () => {
    rememberCheckoutSelection(['A', 'B']);
    m.items = [line('A', 'Dầu gội', { stock: 0 }), line('B', 'Mật ong'), line('C', 'Xà bông')];
    const r = await mount();
    click(byText(problems(r)[0]!, 'button', 'Bỏ khỏi đơn')!);
    await flush(4);
    expect(m.removeCartItem).toHaveBeenCalledWith('A');
  });

  it('lựa chọn đã chết (xoá ở nơi khác): báo món đã chọn không còn, KHÔNG báo giá hay dựng đơn cho cả giỏ, nút Về giỏ hàng và dọn bộ nhớ', async () => {
    rememberCheckoutSelection(['gone']);
    m.items = [line('B', 'Mật ong'), line('C', 'Xà bông')];
    const r = await mount();
    expect(r.container.textContent).toContain('Món bạn chọn không còn trong giỏ');
    expect(byText(r.container, 'button', 'Đặt hàng')).toBeNull();
    expect(r.container.textContent).not.toContain('Mật ong');
    expect(m.quote).not.toHaveBeenCalled();
    expect(m.place).not.toHaveBeenCalled();
    click(byText(r.container, 'button', 'Về giỏ hàng')!);
    await flush(2);
    expect(m.replace).toHaveBeenCalledWith('/gio-hang');
    expect(recallCheckoutSelection()).toBeUndefined();
  });

  it('đặt một phần chưa rõ kết quả, rồi các món đã đặt biến khỏi giỏ: màn "Đơn có thể đã được tạo" gửi lại đúng đơn cũ, không rơi về cả giỏ', async () => {
    rememberCheckoutSelection(['A']);
    m.items = [line('A', 'Dầu gội'), line('B', 'Mật ong')];
    m.place.mockRejectedValueOnce(new NetworkError(false)).mockResolvedValueOnce({ id: 'o1', code: 'TT001', items: [], total: 130000 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const r = render(<CheckoutPage />, client);
    mounted.push(r);
    await flush(8);
    click(byText(r.container, 'button', 'Đặt hàng')!);
    await flush(8);
    expect(m.place).toHaveBeenCalledTimes(1);
    expect(m.place.mock.calls[0]![0]).toMatchObject({ itemIds: ['A'] });
    m.items = [line('B', 'Mật ong')];
    await client.invalidateQueries({ queryKey: ['cart'] });
    await flush(8);
    expect(r.container.textContent).toContain('Đơn của bạn có thể đã được tạo');
    expect(r.container.textContent).not.toContain('Mật ong');
    click(byText(r.container, 'button', 'Kiểm tra lại')!);
    await flush(8);
    expect(m.place).toHaveBeenCalledTimes(2);
    expect(m.place.mock.calls[1]![0]).toEqual(m.place.mock.calls[0]![0]);
    expect(m.place.mock.calls[1]![1]).toBe(m.place.mock.calls[0]![1]);
  });

  it('giỏ trống thật (không phải lựa chọn chết) vẫn là màn giỏ trống', async () => {
    rememberCheckoutSelection(['gone']);
    m.items = [];
    const r = await mount();
    expect(r.container.textContent).not.toContain('Món bạn chọn không còn trong giỏ');
    expect(m.quote).not.toHaveBeenCalled();
  });
});
