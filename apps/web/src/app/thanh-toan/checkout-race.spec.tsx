// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };
const line = (id: string) => ({ id, variationId: `v${id}`, productName: `SP ${id}`, variationName: null, slug: id, thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 });
const cartOf = (...ids: string[]) => ({
  items: ids.map(line), couponCode: null, subtotal: 100000 * ids.length, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: ids.length,
});

const m = vi.hoisted(() => ({ quote: vi.fn(), placeOrder: vi.fn(), getCart: vi.fn(), getMe: vi.fn(), replace: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: m.replace, push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: (...args: unknown[]) => m.getCart(...args),
  getMe: (...args: unknown[]) => m.getMe(...args),
  getMyCoupons: async () => [],
  getAddresses: async () => [ADDR],
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
}));

vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/site-search', () => ({ default: () => null }));

import CheckoutPage from './page';
import SiteHeader from '@/components/site-header';

let qcRef: QueryClient;
function GrabClient() {
  qcRef = useQueryClient();
  return null;
}

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<><GrabClient /><SiteHeader /><CheckoutPage /></>);
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
  m.getMe.mockReset().mockResolvedValue({ pointsBalance: 0, walletBalance: 0 });
  m.replace.mockReset();
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — đua giữa kết quả đặt đơn và dữ liệu nạp lại', () => {
  const failFirst = async () => {
    sessionStorage.setItem('tubu_checkout_selection', JSON.stringify({ itemIds: ['A'] }));
    m.placeOrder.mockRejectedValueOnce(new NetworkError(false)).mockResolvedValue({ id: 'o1', code: 'TT1', paymentMethod: 'COD', total: 130000 });
    const r = await mount();
    click(placeButton(r));
    await flush(6);
    return r;
  };
  const expectResentSame = async (r: Rendered) => {
    click(placeButton(r));
    await flush(6);
    expect(m.placeOrder).toHaveBeenCalledTimes(2);
    expect(m.placeOrder.mock.calls[1]![0]).toEqual(m.placeOrder.mock.calls[0]![0]);
    expect(m.placeOrder.mock.calls[1]![1]).toBe(m.placeOrder.mock.calls[0]![1]);
  };

  it('lỗi mạng khi đặt một phần giỏ rồi có mạng lại, header cùng quan sát giỏ nạp lại: bấm lại gửi đúng body và key cũ', async () => {
    const r = await failFirst();
    m.getCart.mockResolvedValue(cartOf('B'));
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    await flush(8);
    await expectResentSame(r);
    expect(m.placeOrder.mock.calls[1]![0].itemIds).toEqual(['A']);
  });

  it('lỗi mạng rồi giỏ bị làm mới trực tiếp: bấm lại vẫn gửi đúng body và key cũ', async () => {
    const r = await failFirst();
    m.getCart.mockResolvedValue(cartOf('B'));
    await qcRef.invalidateQueries({ queryKey: ['cart'] });
    await flush(8);
    await expectResentSame(r);
  });

  it('lỗi mạng rồi số dư ví nạp lại tụt xuống (đơn đã tạo): radio tự đổi sang COD nhưng bấm lại vẫn gửi đúng body và key cũ', async () => {
    m.getMe.mockResolvedValue({ pointsBalance: 0, walletBalance: 500000 });
    m.placeOrder.mockRejectedValueOnce(new NetworkError(false)).mockResolvedValue({ id: 'o1', code: 'TT1', paymentMethod: 'WALLET', total: 130000 });
    const r = await mount();
    radio(r, 'Ví Tubu').click();
    await flush(4);
    click(placeButton(r));
    await flush(6);
    m.getMe.mockResolvedValue({ pointsBalance: 0, walletBalance: 70000 });
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    await flush(8);
    await expectResentSame(r);
    expect(m.placeOrder.mock.calls[1]![0].paymentMethod).toBe('WALLET');
  });

  it('lần gửi lại bị 401 hoặc 429 (chưa tới nghiệp vụ): vẫn giữ đóng băng, lần sau gửi đúng body và key cũ', async () => {
    const r = await failFirst();
    m.getCart.mockResolvedValue(cartOf('B'));
    await qcRef.invalidateQueries({ queryKey: ['cart'] });
    await flush(8);
    const [b1, k1] = m.placeOrder.mock.calls[0]!;
    expect(b1.itemIds).toEqual(['A']);
    m.placeOrder.mockReset().mockRejectedValueOnce(new ApiError('x', 401)).mockRejectedValueOnce(new ApiError('x', 429)).mockResolvedValue({ id: 'o1', code: 'TT1', paymentMethod: 'COD', total: 130000 });
    click(placeButton(r));
    await flush(6);
    click(placeButton(r));
    await flush(6);
    click(placeButton(r));
    await flush(6);
    expect(m.placeOrder).toHaveBeenCalledTimes(3);
    expect(m.placeOrder.mock.calls[2]![0]).toEqual(b1);
    expect(m.placeOrder.mock.calls[2]![1]).toBe(k1);
  });

  it('lỗi 5xx cũng đóng băng: bấm lại gửi đúng body và key cũ, và hiện gợi ý đơn có thể đã tạo', async () => {
    sessionStorage.setItem('tubu_checkout_selection', JSON.stringify({ itemIds: ['A'] }));
    m.placeOrder.mockRejectedValueOnce(new ApiError('Lỗi máy chủ', 502)).mockResolvedValue({ id: 'o1', code: 'TT1', paymentMethod: 'COD', total: 130000 });
    const r = await mount();
    click(placeButton(r));
    await flush(6);
    expect(r.container.textContent).toContain('Đơn có thể đã được ghi nhận');
    expect(r.container.querySelector('a[href="/tai-khoan/don-hang"]')).not.toBeNull();
    await expectResentSame(r);
  });

  it('hai lần bấm liền trong cùng một nhịp: cùng body nên cùng key, máy chủ gộp thành một đơn', async () => {
    m.placeOrder.mockReturnValue(new Promise(() => {}));
    const r = await mount();
    click(placeButton(r));
    click(placeButton(r));
    await flush(4);
    const keys = new Set(m.placeOrder.mock.calls.map((c) => c[1]));
    expect(keys.size).toBe(1);
  });

  it('khách tự đổi cách thanh toán sau lỗi mạng: báo kiểm tra Đơn hàng, bấm tiếp mới tạo đơn mới với key mới', async () => {
    const r = await failFirst();
    radio(r, 'Chuyển khoản ngân hàng').click();
    await flush(4);
    click(placeButton(r));
    await flush(6);
    expect(m.placeOrder).toHaveBeenCalledTimes(1);
    expect(r.container.textContent).toContain('Đơn trước có thể đã được tạo');
    expect(r.container.querySelector('a[href="/tai-khoan/don-hang"]')).not.toBeNull();
    click(placeButton(r));
    await flush(6);
    expect(m.placeOrder).toHaveBeenCalledTimes(2);
    expect(m.placeOrder.mock.calls[1]![0].paymentMethod).toBe('BANK_TRANSFER');
    expect(m.placeOrder.mock.calls[1]![1]).not.toBe(m.placeOrder.mock.calls[0]![1]);
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
