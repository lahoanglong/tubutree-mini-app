// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// L2 (K2 MINOR c, d): từ lg khung "Đơn hàng" không dính; nút Đặt hàng khoá phải ghi lý do ngay cạnh nút (như thanh dính của điện thoại)
// và lỗi đặt đơn phải thấy được: lý do nằm cạnh nút, nút được cuộn tới và nhận focus.

const state = vi.hoisted(() => ({
  placeError: null as Error | null,
  quoteError: null as Error | null,
  noAddress: false,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u', walletBalance: 0, pointsBalance: 0 }, status: 'authenticated', initialized: true }),
}));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [
      { id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 150000, quantity: 2, stock: 5, total: 300000 },
    ],
    couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 2,
  }),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  getAddresses: async () =>
    state.noAddress
      ? []
      : [{ id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: 'p', districtCode: '', wardCode: 'w', isDefault: true }],
  checkoutQuote: async () => {
    if (state.quoteError) throw state.quoteError;
    return {
      subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 330000, pointsEarned: 0,
      pointsBalance: 0, redeemablePoints: 0,
    };
  },
  placeOrder: async () => {
    // Một nhịp mạng: có lúc "đang đặt" (isError tạm tắt) giữa hai lần lỗi, như thật; không có thì hai lỗi cùng đối tượng gộp thành một lần render.
    await new Promise((r) => setTimeout(r, 0));
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
const part = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-mini-part="place-order"]')!;
const lgButton = (c: HTMLElement) => part(c).querySelector<HTMLButtonElement>('button')!;
const note = (c: HTMLElement) => part(c).querySelector<HTMLElement>('[data-testid="place-note-lg"]');
const errorNote = (c: HTMLElement) => part(c).querySelector<HTMLElement>('[data-testid="place-error-lg"]');

const scrollIntoView = vi.fn();
const setDesktop = (desktop: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: desktop && query.includes('64rem'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  sessionStorage.clear();
  state.placeError = null;
  state.quoteError = null;
  state.noAddress = false;
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  setDesktop(true);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan lg: lý do khoá nút Đặt hàng nằm cạnh nút (K2 c)', () => {
  it('chưa có địa chỉ: vùng role=status cạnh nút ghi lý do (chữ phụ, không đỏ), nút khoá', async () => {
    state.noAddress = true;
    const c = await mount();
    const region = note(c)!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.textContent).toBe('Chọn địa chỉ giao hàng để đặt hàng.');
    expect(region.className).toContain('--color-text-secondary');
    expect(region.className).not.toContain('danger');
    expect(lgButton(c).disabled).toBe(true);
    // Cùng khối với nút và đứng ngay dưới nó (như lời báo lỗi đặt hàng), dòng đồng ý điều khoản vẫn sát trên nút.
    expect(part(c).contains(region)).toBe(true);
    expect(lgButton(c).nextElementSibling).toBe(region);
  });

  it('báo giá lỗi (có địa chỉ): câu khác với câu thiếu địa chỉ', async () => {
    state.quoteError = new Error('boom');
    const c = await mount();
    expect(note(c)!.textContent).toContain('Chưa tính được tổng tiền.');
  });

  it('đủ địa chỉ và báo giá: vùng vẫn có mặt nhưng trống và ẩn thị giác; không đổi phần tử khi lỗi đặt hàng hiện ra', async () => {
    state.placeError = new Error('Địa chỉ giao không hợp lệ.');
    const c = await mount();
    const before = note(c)!;
    expect(before.textContent).toBe('');
    expect(before.className).toContain('sr-only');
    click(lgButton(c));
    await flush(6);
    expect(note(c)).toBe(before);
  });

  it('chỉ hiện từ lg: dưới lg vùng bị ẩn bằng lớp (thanh dính đáy giữ vùng của điện thoại)', async () => {
    state.noAddress = true;
    const c = await mount();
    expect(note(c)!.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(note(c)!.className).toContain('lg:');
  });
});

describe('/thanh-toan lg: lỗi đặt đơn thấy được (K2 d)', () => {
  it('đặt đơn lỗi: lời báo nằm cạnh nút, nút được cuộn tới (nearest) và nhận focus; lỗi lần hai lặp lại', async () => {
    state.placeError = new Error('Địa chỉ giao không hợp lệ.');
    const c = await mount();
    click(lgButton(c));
    await flush(6);
    expect(part(c).querySelector('[role="alert"]')!.textContent).toContain('Địa chỉ giao không hợp lệ.');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(document.activeElement).toBe(lgButton(c));
    // Khách bấm ra chỗ khác rồi đặt lại, lỗi mới: lại cuộn và trả focus về nút.
    (document.activeElement as HTMLElement).blur();
    click(lgButton(c));
    await flush(6);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(lgButton(c));
  });

  it('giá ưu đãi đổi: lý do ngắn nằm cạnh nút (không thêm role=alert thứ hai, banner đầu trang đã là alert)', async () => {
    state.placeError = new Error('PRICE_CHANGED');
    const c = await mount();
    click(lgButton(c));
    await flush(6);
    expect(errorNote(c)!.textContent).toBe('Giá ưu đãi đã thay đổi. Bạn xem lại giỏ hàng trước khi đặt nhé.');
    expect(errorNote(c)!.getAttribute('aria-hidden')).toBe('true');
    expect(part(c).querySelector('[role="alert"]')).toBeNull();
    expect(c.querySelectorAll('[data-testid="checkout-price-changed"]')).toHaveLength(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(lgButton(c));
  });

  it('lỗi đặt đơn thường không dựng thêm dòng lý do lặp (đã có khối role=alert)', async () => {
    state.placeError = new Error('Địa chỉ giao không hợp lệ.');
    const c = await mount();
    click(lgButton(c));
    await flush(6);
    expect(errorNote(c)).toBeNull();
  });

  it('điện thoại (dưới lg): không cuộn trang và không kéo focus về nút ẩn, thanh dính đáy lo phần này', async () => {
    setDesktop(false);
    state.placeError = new Error('Địa chỉ giao không hợp lệ.');
    const c = await mount();
    click(c.querySelector<HTMLButtonElement>('[data-testid="sticky-bar"] button')!);
    await flush(6);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(lgButton(c));
  });
});
