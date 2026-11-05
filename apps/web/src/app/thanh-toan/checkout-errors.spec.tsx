// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };

const m = vi.hoisted(() => ({ quote: vi.fn(), placeOrder: vi.fn(), cart: vi.fn() }));

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

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.placeOrder.mockReset();
  m.cart.mockReset().mockResolvedValue({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }],
    couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  });
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — lỗi đặt đơn như Mini App', () => {
  it('PRICE_CHANGED (hết suất/hết giờ vàng): báo bằng câu dễ hiểu, kèm đường về giỏ, tải lại giỏ và báo giá — không lộ mã lỗi', async () => {
    m.placeOrder.mockRejectedValue(new ApiError('PRICE_CHANGED', 400));
    const r = await mount();
    const carts = m.cart.mock.calls.length;
    const quotes = m.quote.mock.calls.length;
    click(placeButton(r));
    await flush(8);
    const alert = r.container.querySelector('[data-testid="checkout-price-changed"]')!;
    expect(alert.textContent).toContain('Giá ưu đãi đã thay đổi');
    expect(alert.textContent).toContain('Vài sản phẩm Giờ vàng vừa hết suất hoặc hết giờ nên giá đã đổi. Bạn cập nhật giá mới rồi đặt tiếp nhé.');
    expect(alert.querySelector('a')!.getAttribute('href')).toBe('/gio-hang');
    expect(alert.querySelector('a')!.textContent).toBe('Xem lại giỏ hàng');
    expect(byText(alert, 'button', 'Cập nhật giá mới')).toBeTruthy();
    expect(r.container.textContent).not.toContain('PRICE_CHANGED');
    expect(m.cart.mock.calls.length).toBeGreaterThan(carts);
    expect(m.quote.mock.calls.length).toBeGreaterThan(quotes);
  });

  it('"Cập nhật giá mới": bỏ banner lỗi, báo tổng mới ngay tại màn, đặt tiếp gửi đúng tổng mới', async () => {
    m.placeOrder.mockRejectedValueOnce(new ApiError('PRICE_CHANGED', 400)).mockResolvedValueOnce({ id: 'o1', code: 'TT001', status: 'CONFIRMED', subtotal: 95000, discount: 0, shippingFee: 30000, total: 125000, paymentMethod: 'COD', createdAt: '2026-11-05T00:00:00Z', items: [] });
    const r = await mount();
    // Báo giá tải lại ngay sau lỗi giá đổi, nên giá mới về từ lần tải đó.
    m.quote.mockResolvedValue({ ...QUOTE, total: 125000 });
    click(placeButton(r));
    await flush(8);
    click(byText(r.container, 'button', 'Cập nhật giá mới')!);
    await flush(8);
    expect(r.container.querySelector('[data-testid="checkout-price-changed"]')).toBeNull();
    const note = r.container.querySelector('[data-testid="checkout-price-updated"]')!;
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toContain('Đã cập nhật giá. Tổng mới 125.000đ.');
    click(byText(r.container, 'button', 'Đặt hàng · 125.000đ')!);
    await flush(8);
    expect(m.placeOrder).toHaveBeenCalledTimes(2);
    expect((m.placeOrder.mock.calls[1]![0] as { expectedTotal: number }).expectedTotal).toBe(125000);
  });

  it('CART_CHANGED (giỏ vừa đổi ở tab khác): giữ câu của máy chủ và tải lại giỏ, báo giá, đơn', async () => {
    const message = 'Giỏ hàng vừa thay đổi. Vui lòng kiểm tra lại trước khi đặt.';
    m.placeOrder.mockRejectedValue(new ApiError(message, 400, 'CART_CHANGED'));
    const r = await mount();
    const carts = m.cart.mock.calls.length;
    const quotes = m.quote.mock.calls.length;
    click(placeButton(r));
    await flush(8);
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(m.cart.mock.calls.length).toBeGreaterThan(carts);
    expect(m.quote.mock.calls.length).toBeGreaterThan(quotes);
  });

  it('FLASH_LIMIT: banner "sửa ở giỏ" với câu giới hạn của máy chủ, tải lại giỏ, không lặp thêm một khối lỗi thứ hai', async () => {
    const message = 'Giá Giờ vàng chỉ áp cho 2 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.';
    m.placeOrder.mockRejectedValue(new ApiError(message, 400, 'FLASH_LIMIT'));
    const r = await mount();
    const carts = m.cart.mock.calls.length;
    click(placeButton(r));
    await flush(8);
    const banner = r.container.querySelector('[data-testid="checkout-cart-issue"]')!;
    expect(banner.textContent).toContain(message);
    expect(banner.querySelector('a')!.getAttribute('href')).toBe('/gio-hang');
    expect(m.cart.mock.calls.length).toBeGreaterThan(carts);
    expect(Array.from(r.container.querySelectorAll('[role="alert"]')).filter((a) => a.textContent?.includes(message))).toHaveLength(1);
  });

  it('câu cũ "Vượt giới hạn mua ưu đãi." vẫn là banner sửa ở giỏ', async () => {
    m.placeOrder.mockRejectedValue(new ApiError('Vượt giới hạn mua ưu đãi.', 400));
    const r = await mount();
    click(placeButton(r));
    await flush(8);
    expect(r.container.querySelector('[data-testid="checkout-cart-issue"]')!.textContent).toContain('Vượt giới hạn mua ưu đãi.');
  });
});

describe('/thanh-toan — gửi lỗi mạng giữ nguyên đơn (hk)', () => {
  const placed = { id: 'o1', code: 'TT001', status: 'CONFIRMED', subtotal: 100000, discount: 0, shippingFee: 30000, total: 130000, paymentMethod: 'COD', createdAt: '2026-11-05T00:00:00Z', items: [] };

  it('lỗi mạng: nút đổi thành "Thử lại · tổng", dải đáy nói chưa gửi được đơn, bấm lại gửi đúng body và khoá cũ', async () => {
    m.placeOrder.mockRejectedValueOnce(new NetworkError(true)).mockResolvedValueOnce(placed);
    const r = await mount();
    click(placeButton(r));
    await flush(8);
    const retry = byText(r.container, 'button', 'Thử lại · 130.000đ') as HTMLButtonElement;
    expect(retry).toBeTruthy();
    expect(retry.disabled).toBe(false);
    expect(byText(r.container, 'button', 'Đặt hàng · ')).toBeNull();
    expect(r.container.textContent).toContain('Chưa rõ đơn đã được ghi nhận chưa. Bấm Thử lại để gửi lại đúng đơn này, hệ thống không tạo đơn trùng.');
    click(retry);
    await flush(8);
    expect(m.placeOrder).toHaveBeenCalledTimes(2);
    expect(m.placeOrder.mock.calls[1]![0]).toEqual(m.placeOrder.mock.calls[0]![0]);
    expect(m.placeOrder.mock.calls[1]![1]).toBe(m.placeOrder.mock.calls[0]![1]);
  });

  it('lỗi 4xx rõ ràng: nút vẫn là "Đặt hàng · tổng", không nói "Chưa rõ đơn đã được ghi nhận chưa"', async () => {
    m.placeOrder.mockRejectedValue(new ApiError('Địa chỉ không hợp lệ.', 400));
    const r = await mount();
    click(placeButton(r));
    await flush(8);
    expect(byText(r.container, 'button', 'Đặt hàng · 130.000đ')).toBeTruthy();
    expect(r.container.textContent).not.toContain('Chưa rõ đơn đã được ghi nhận chưa');
  });

  it('khung báo lỗi theo tên nút: nói Bấm Thử lại, không còn "Bấm Đặt hàng lần nữa để thử lại"', async () => {
    m.placeOrder.mockRejectedValueOnce(new NetworkError(true));
    const r = await mount();
    click(placeButton(r));
    await flush(8);
    const alert = r.container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Đơn có thể đã được ghi nhận. Bấm Thử lại để gửi lại đúng đơn này');
    expect(alert.textContent).not.toContain('Bấm Đặt hàng lần nữa');
  });

  it('đổi lựa chọn sau lỗi chưa rõ kết quả (đổi cách thanh toán): nút về "Đặt hàng · tổng", không còn câu "không tạo đơn trùng"; bấm kế bị chặn, bấm sau gửi với khoá khác', async () => {
    m.placeOrder.mockRejectedValueOnce(new NetworkError(true)).mockResolvedValue(placed);
    const r = await mount();
    click(placeButton(r));
    await flush(8);
    expect(byText(r.container, 'button', 'Thử lại · 130.000đ')).toBeTruthy();
    const bank = [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes('Chuyển khoản'))!.querySelector('input')!;
    bank.click();
    await flush(6);
    expect(byText(r.container, 'button', 'Đặt hàng · 130.000đ')).toBeTruthy();
    expect(byText(r.container, 'button', 'Thử lại · ')).toBeNull();
    expect(r.container.textContent).not.toContain('hệ thống không tạo đơn trùng');
    expect(r.container.textContent).not.toContain('Bấm Thử lại');
    click(byText(r.container, 'button', 'Đặt hàng · 130.000đ')!);
    await flush(8);
    expect(m.placeOrder).toHaveBeenCalledTimes(1);
    expect(r.container.textContent).toContain('Đơn trước có thể đã được tạo');
    click(byText(r.container, 'button', 'Đặt hàng · 130.000đ')!);
    await flush(8);
    expect(m.placeOrder).toHaveBeenCalledTimes(2);
    expect(m.placeOrder.mock.calls[1]![1]).not.toBe(m.placeOrder.mock.calls[0]![1]);
  });
});
