// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { NetworkError } from '@/lib/client-api';

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };

const m = vi.hoisted(() => ({ quote: vi.fn(), placeOrder: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }],
    couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  }),
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
const keyOf = (call: number) => m.placeOrder.mock.calls[call]![1] as string;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.placeOrder.mockReset();
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — Idempotency-Key theo nội dung đơn (như Mini App)', () => {
  it('lỗi mạng rồi bấm lại cùng nội dung → gửi lại đúng key cũ', async () => {
    m.placeOrder.mockRejectedValueOnce(new NetworkError(false)).mockReturnValue(new Promise(() => undefined));
    const r = await mount();
    click(placeButton(r));
    await flush(6);
    click(placeButton(r));
    await flush(6);
    expect(m.placeOrder).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it('đổi cách trả tiền giữa hai lần bấm → key mới; đổi lại như cũ → key cũ', async () => {
    m.placeOrder.mockRejectedValue(new NetworkError(false));
    const r = await mount();
    click(placeButton(r));
    await flush(6);
    click(radio(r, 'Chuyển khoản ngân hàng'));
    await flush(4);
    click(placeButton(r));
    await flush(6);
    expect(keyOf(1)).not.toBe(keyOf(0));
    click(radio(r, 'Thanh toán khi nhận hàng'));
    await flush(4);
    click(placeButton(r));
    await flush(6);
    expect(keyOf(2)).toBe(keyOf(0));
  });

  it('tổng báo giá đổi (expectedTotal) nhưng nội dung đơn không đổi → vẫn key cũ', async () => {
    m.placeOrder.mockRejectedValue(new NetworkError(false));
    const r = await mount();
    click(placeButton(r));
    await flush(6);
    m.quote.mockResolvedValue({ ...QUOTE, shippingFee: 35000, total: 135000 });
    click(placeButton(r));
    await flush(6);
    expect(keyOf(1)).toBe(keyOf(0));
  });
});
