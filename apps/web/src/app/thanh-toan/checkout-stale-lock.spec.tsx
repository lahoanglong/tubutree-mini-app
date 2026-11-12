// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

// Máy chủ từ chối đơn vì màn đã cũ (400/404/409/422): lời lỗi hiện NGAY, nút Đặt hàng giữ khoá (aria-busy) tới khi giỏ và báo giá mới về
// (tối đa `LOCK_REFRESH_WAIT_MS`), như Mini App. Nhả sớm thì chạm lần hai gửi lại đúng đơn vừa bị từ chối trên số cũ.
// Mất mạng, 401 và 5xx không nói gì về giỏ (lần tải lại cũng hỏng): nhả khoá ngay để khách thử lại.

const state = vi.hoisted(() => ({
  placed: [] as Record<string, unknown>[],
  placeError: null as Error | null,
  cartCalls: 0,
  quoteCalls: 0,
  reloadGate: null as Promise<void> | null,
  placeGate: null as Promise<void> | null,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u', walletBalance: 0, pointsBalance: 0 }, status: 'authenticated', initialized: true }),
}));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => {
    state.cartCalls += 1;
    await state.reloadGate;
    return {
      items: [
        { id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 150000, quantity: 2, stock: 5, total: 300000 },
      ],
      couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 2,
    };
  },
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  getAddresses: async () => [
    { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true },
  ],
  checkoutQuote: async () => {
    state.quoteCalls += 1;
    await state.reloadGate;
    return { subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 330000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };
  },
  placeOrder: async (body: Record<string, unknown>) => {
    state.placed.push(body);
    await state.placeGate;
    if (state.placeError) throw state.placeError;
    return { code: 'TT0001', total: 330000 };
  },
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const lgButton = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-mini-part="place-order"] button')!;
const barButton = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="sticky-bar"]')!.querySelector<HTMLButtonElement>('button')!;
const alertText = (c: HTMLElement) => c.querySelector('[data-mini-part="place-order"] [role="alert"]')?.textContent ?? '';
/** Hai cú chạm liên tiếp trước khi React vẽ lại: `click` của harness mở một `act` riêng cho mỗi cú nên không đủ nhanh. */
const pressTwice = (...els: HTMLElement[]) =>
  act(() => {
    for (const el of els) el.click();
  });
const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => {
  sessionStorage.clear();
  state.placed = [];
  state.placeError = null;
  state.cartCalls = 0;
  state.quoteCalls = 0;
  state.reloadGate = null;
  state.placeGate = null;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan — máy chủ từ chối đơn vì màn đã cũ: giữ khoá tới khi giỏ và báo giá mới về', () => {
  it.each([400, 404, 409, 422])('%i: lời lỗi hiện ngay, giỏ và báo giá tải lại, nút báo bận; chạm lần hai không gửi; về xong thì bấm lại được', async (status) => {
    state.placeError = new ApiError('Địa chỉ giao hàng không còn hợp lệ.', status);
    const c = await mount();
    const carts = state.cartCalls;
    const quotes = state.quoteCalls;
    const gate = defer();
    state.reloadGate = gate.promise;
    click(lgButton(c));
    await flush(6);
    expect(alertText(c)).toContain('Địa chỉ giao hàng không còn hợp lệ.');
    expect(state.cartCalls).toBe(carts + 1);
    expect(state.quoteCalls).toBe(quotes + 1);
    for (const btn of [lgButton(c), barButton(c)]) {
      expect(btn.getAttribute('aria-busy')).toBe('true');
      expect(btn.getAttribute('aria-disabled')).toBe('true');
    }
    pressTwice(lgButton(c), barButton(c));
    await flush(3);
    expect(state.placed).toHaveLength(1);
    await act(async () => gate.resolve());
    await flush(6);
    for (const btn of [lgButton(c), barButton(c)]) {
      expect(btn.getAttribute('aria-busy')).toBeNull();
      expect(btn.getAttribute('aria-disabled')).toBeNull();
    }
    click(lgButton(c));
    await flush(6);
    expect(state.placed).toHaveLength(2);
  });

  it('nhãn nút: "Đang đặt hàng…" khi đang gửi, "Đang cập nhật giỏ…" khi bị từ chối vì màn cũ và giỏ đang tải lại, rồi về chữ Đặt hàng', async () => {
    const sendGate = defer();
    state.placeError = new ApiError('Địa chỉ giao hàng không còn hợp lệ.', 409);
    const c = await mount();
    const idleLabel = lgButton(c).textContent;
    expect(idleLabel).toMatch(/^Đặt hàng/);
    const reloadGate = defer();
    state.reloadGate = reloadGate.promise;
    state.placeGate = sendGate.promise;
    click(lgButton(c));
    await flush(3);
    for (const btn of [lgButton(c), barButton(c)]) expect(btn.textContent).toBe('Đang đặt hàng…');
    await act(async () => sendGate.resolve());
    await flush(6);
    for (const btn of [lgButton(c), barButton(c)]) {
      expect(btn.textContent).toBe('Đang cập nhật giỏ…');
      expect(btn.getAttribute('aria-busy')).toBe('true');
      expect(btn.getAttribute('aria-disabled')).toBe('true');
    }
    pressTwice(lgButton(c), barButton(c));
    await flush(3);
    expect(state.placed).toHaveLength(1);
    await act(async () => reloadGate.resolve());
    await flush(6);
    for (const btn of [lgButton(c), barButton(c)]) {
      expect(btn.textContent).toBe(idleLabel);
      expect(btn.getAttribute('aria-busy')).toBeNull();
      expect(btn.getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('lỗi không nói gì về giỏ (500): nút không bao giờ đổi sang "Đang cập nhật giỏ…"', async () => {
    const sendGate = defer();
    state.placeError = new ApiError('Máy chủ bận.', 500);
    const c = await mount();
    state.placeGate = sendGate.promise;
    click(lgButton(c));
    await flush(3);
    expect(lgButton(c).textContent).toBe('Đang đặt hàng…');
    await act(async () => sendGate.resolve());
    await flush(6);
    expect(lgButton(c).textContent).toMatch(/^Đặt hàng|^Thử lại/);
    expect(lgButton(c).textContent).not.toContain('cập nhật giỏ');
  });

  it.each([
    ['CART_CHANGED', 409],
    ['TOTAL_CHANGED', 409],
    ['PAYMENT_METHOD_NOT_ALLOWED', 400],
  ])('mã nghiệp vụ %s (%i): giữ khoá tới khi dữ liệu về; chạm lần hai không gửi', async (code, status) => {
    state.placeError = new ApiError('Giỏ hàng vừa thay đổi.', status, code);
    const c = await mount();
    const gate = defer();
    state.reloadGate = gate.promise;
    click(barButton(c));
    await flush(6);
    expect(barButton(c).getAttribute('aria-busy')).toBe('true');
    pressTwice(lgButton(c), barButton(c));
    await flush(3);
    expect(state.placed).toHaveLength(1);
    await act(async () => gate.resolve());
    await flush(6);
    expect(barButton(c).getAttribute('aria-busy')).toBeNull();
  });

  it('giá ưu đãi đổi (PRICE_CHANGED): banner hiện ngay, nút giữ khoá tới khi giỏ và báo giá về', async () => {
    state.placeError = new ApiError('PRICE_CHANGED', 400);
    const c = await mount();
    const gate = defer();
    state.reloadGate = gate.promise;
    click(barButton(c));
    await flush(6);
    expect(c.querySelector('[data-testid="checkout-price-changed"]')).not.toBeNull();
    expect(barButton(c).getAttribute('aria-busy')).toBe('true');
    pressTwice(barButton(c));
    await flush(3);
    expect(state.placed).toHaveLength(1);
    await act(async () => gate.resolve());
    await flush(6);
    expect(barButton(c).getAttribute('aria-busy')).toBeNull();
  });

  it.each([
    ['lỗi 500', () => new ApiError('Máy chủ bận.', 500)],
    ['lỗi 401', () => new ApiError('Phiên đăng nhập đã hết hạn.', 401)],
    ['mất mạng', () => new NetworkError(false)],
  ])('%s: lời lỗi hiện, KHÔNG tải lại giỏ/báo giá (lần tải cũng hỏng), nhả khoá ngay', async (_name, makeError) => {
    state.placeError = makeError();
    const c = await mount();
    const carts = state.cartCalls;
    const quotes = state.quoteCalls;
    click(lgButton(c));
    await flush(6);
    expect(alertText(c)).not.toBe('');
    expect(state.cartCalls).toBe(carts);
    expect(state.quoteCalls).toBe(quotes);
    expect(lgButton(c).getAttribute('aria-busy')).toBeNull();
    expect(barButton(c).getAttribute('aria-busy')).toBeNull();
    click(lgButton(c));
    await flush(6);
    expect(state.placed).toHaveLength(2);
  });
});
