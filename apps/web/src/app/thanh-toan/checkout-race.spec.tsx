// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { NetworkError } from '@/lib/client-api';

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };
const line = (id: string) => ({ id, variationId: `v${id}`, productName: `SP ${id}`, variationName: null, slug: id, thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 });
const cartOf = (...ids: string[]) => ({
  items: ids.map(line), couponCode: null, subtotal: 100000 * ids.length, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: ids.length,
});

const m = vi.hoisted(() => ({ quote: vi.fn(), placeOrder: vi.fn(), getCart: vi.fn(), replace: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: m.replace, push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: (...args: unknown[]) => m.getCart(...args),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getAddresses: async () => [ADDR],
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const placeButton = (r: Rendered) => byText(r.container, 'button', 'Đặt hàng') as HTMLButtonElement;
const radio = (r: Rendered, label: string) =>
  [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.placeOrder.mockReset();
  m.getCart.mockReset().mockResolvedValue(cartOf('A', 'B'));
  m.replace.mockReset();
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — đua giữa kết quả đặt đơn và dữ liệu nạp lại', () => {
  it('lỗi mạng khi đặt một phần giỏ rồi trình duyệt có mạng lại: không nạp lại giỏ để body không đổi theo', async () => {
    sessionStorage.setItem('tubu_checkout_selection', JSON.stringify({ itemIds: ['A'] }));
    m.placeOrder.mockRejectedValue(new NetworkError(false));
    const r = await mount();
    click(placeButton(r));
    await flush(6);
    const cartCalls = m.getCart.mock.calls.length;
    m.getCart.mockResolvedValue(cartOf('B'));
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    await flush(8);
    expect(m.getCart.mock.calls.length).toBe(cartCalls);
    click(placeButton(r));
    await flush(6);
    expect(m.placeOrder).toHaveBeenCalledTimes(2);
    expect(m.placeOrder.mock.calls[1]![0].itemIds).toEqual(['A']);
    expect(m.placeOrder.mock.calls[1]![1]).toBe(m.placeOrder.mock.calls[0]![1]);
  });

  it('khách đổi radio sang chuyển khoản trong lúc chờ, máy chủ tạo đơn COD: không chuyển sang trang VietQR', async () => {
    let resolve!: (o: unknown) => void;
    m.placeOrder.mockReturnValue(new Promise((res) => { resolve = res; }));
    const r = await mount();
    click(placeButton(r));
    await flush(4);
    expect(radio(r, 'Chuyển khoản ngân hàng').disabled).toBe(true);
    radio(r, 'Chuyển khoản ngân hàng').click();
    resolve({ id: 'o1', code: 'TT1', paymentMethod: 'COD', total: 130000 });
    await flush(8);
    expect(m.replace).not.toHaveBeenCalled();
  });
});
