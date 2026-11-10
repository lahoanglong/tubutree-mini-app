// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, flush, render, type Rendered } from '@/test-utils/dom';
import { cartKey } from '@/lib/cart-key';

// W91B (Mini W92A): "Thử lại" ở thanh toán khoá đồng bộ. `refetch()` mặc định huỷ lần tải trước rồi hỏi lại, nên hai cú chạm sát nhau
// (trước khi React vẽ lại) gửi hai yêu cầu; nút trả Promise thì khoá chạm lại tới khi tải xong và báo aria-busy.

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };
const CART = {
  items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }],
  couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
};

const m = vi.hoisted(() => ({ quote: vi.fn(), cart: vi.fn(), addresses: vi.fn() }));
const never = () => new Promise<never>(() => undefined);

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: (...args: unknown[]) => m.cart(...args),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  getAddresses: (...args: unknown[]) => m.addresses(...args),
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
let qc: QueryClient;
const mount = async () => {
  const r = render(<CheckoutPage />, qc);
  mounted.push(r);
  await flush(8);
  return r;
};
const retryButton = (r: Rendered) => byText(r.container, 'button', 'Thử lại') as HTMLButtonElement;
/** Hai cú chạm liên tiếp trước khi React vẽ lại: `click` của harness mở một `act` riêng cho mỗi cú nên không đủ nhanh. */
const pressTwice = (el: HTMLElement) =>
  act(() => {
    el.click();
    el.click();
  });

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.cart.mockReset().mockResolvedValue(CART);
  m.addresses.mockReset().mockResolvedValue([ADDR]);
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — Thử lại khoá chạm đúp (W91B)', () => {
  it('địa chỉ lỗi tải lại khi đã có sổ cũ: chạm đúp cùng khung hình chỉ tải lại địa chỉ một lần, nút aria-busy', async () => {
    const r = await mount();
    m.addresses.mockRejectedValueOnce(new Error('mất mạng'));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['addresses'] });
    });
    await flush(3);
    expect(r.container.textContent).toContain('Không tải được danh sách địa chỉ.');
    const callsBefore = m.addresses.mock.calls.length;
    m.addresses.mockImplementationOnce(never);
    pressTwice(retryButton(r));
    await flush(3);
    expect(m.addresses).toHaveBeenCalledTimes(callsBefore + 1);
    expect(retryButton(r).getAttribute('aria-busy')).toBe('true');
  });

  it('báo giá lỗi khi đã có số cũ: chạm đúp chỉ hỏi lại một lần, nút aria-busy tới khi báo giá về rồi chạm lại được', async () => {
    const r = await mount();
    m.quote.mockRejectedValueOnce(new Error('mất mạng'));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['quote'] });
    });
    await flush(3);
    expect(r.container.textContent).toContain('Không tính được phí ship/tổng tiền');
    const callsBefore = m.quote.mock.calls.length;
    let release!: () => void;
    m.quote.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(QUOTE))));
    pressTwice(retryButton(r));
    await flush(3);
    expect(m.quote).toHaveBeenCalledTimes(callsBefore + 1);
    // Lúc đang tải lại, dòng báo lỗi còn nguyên (báo giá cũ vẫn là dữ liệu cũ) nên nút phải báo bận và không nhận thêm cú chạm.
    expect(retryButton(r).getAttribute('aria-busy')).toBe('true');
    expect(retryButton(r).getAttribute('aria-disabled')).toBe('true');
    expect(retryButton(r).disabled).toBe(false);
    act(() => retryButton(r).click());
    await flush(2);
    expect(m.quote).toHaveBeenCalledTimes(callsBefore + 1);
    await act(async () => release());
    await flush(6);
    expect(r.container.textContent).not.toContain('Không tính được phí ship/tổng tiền');
  });

  it('báo giá lại lỗi sau lần Thử lại: hết bận thì chạm lại được và gửi lần hỏi mới', async () => {
    const r = await mount();
    m.quote.mockRejectedValueOnce(new Error('mất mạng'));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['quote'] });
    });
    await flush(3);
    const callsBefore = m.quote.mock.calls.length;
    let fail!: () => void;
    m.quote.mockImplementationOnce(() => new Promise((_, reject) => (fail = () => reject(new Error('vẫn mất mạng')))));
    act(() => retryButton(r).click());
    await flush(3);
    expect(m.quote).toHaveBeenCalledTimes(callsBefore + 1);
    expect(retryButton(r).getAttribute('aria-busy')).toBe('true');
    await act(async () => fail());
    await flush(6);
    expect(r.container.textContent).toContain('Không tính được phí ship/tổng tiền');
    expect(retryButton(r).getAttribute('aria-busy')).toBeNull();
    m.quote.mockImplementationOnce(never);
    act(() => retryButton(r).click());
    await flush(3);
    expect(m.quote).toHaveBeenCalledTimes(callsBefore + 2);
  });

  it('giỏ lỗi khi đã có dòng hàng: chạm đúp chỉ tải lại giỏ một lần', async () => {
    const r = await mount();
    m.cart.mockRejectedValueOnce(new Error('mất mạng'));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: cartKey() });
    });
    await flush(3);
    expect(r.container.textContent).toContain('Không tải được giỏ hàng.');
    const callsBefore = m.cart.mock.calls.length;
    m.cart.mockImplementationOnce(never);
    pressTwice(retryButton(r));
    await flush(3);
    expect(m.cart).toHaveBeenCalledTimes(callsBefore + 1);
    expect(retryButton(r).getAttribute('aria-busy')).toBe('true');
  });
});
