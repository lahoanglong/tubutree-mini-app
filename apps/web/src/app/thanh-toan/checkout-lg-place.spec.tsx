// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// L2 (K2 MINOR c, d): từ lg khung "Đơn hàng" không dính; nút Đặt hàng khoá phải ghi lý do ngay cạnh nút (như thanh dính của điện thoại)
// và lỗi đặt đơn phải thấy được: lý do nằm cạnh nút, nút được cuộn tới và nhận focus.

const state = vi.hoisted(() => ({
  placeError: null as Error | null,
  quoteError: null as Error | null,
  noAddress: false,
  // Báo giá bị giữ tới khi test mở (holdQuote/releaseQuote): lỗi đặt đơn như PRICE_CHANGED/TOTAL_CHANGED tải lại báo giá trong onError nên
  // nút còn khoá đúng lúc trạng thái lỗi hiện ra. Không dùng hẹn giờ thật: máy CI bận thì báo giá về trước khi test kịp thấy nút khoá.
  quoteHeld: null as Promise<void> | null,
  // Điểm Xanh dùng được: > 0 thì ô tick "Điểm Xanh" hiện trong khung Đơn hàng.
  points: 0,
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
    if (state.quoteHeld) await state.quoteHeld;
    if (state.quoteError) throw state.quoteError;
    return {
      subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 330000, pointsEarned: 0,
      pointsBalance: state.points, redeemablePoints: state.points,
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

let releaseHeld: (() => void) | null = null;
const holdQuote = () => {
  state.quoteHeld = new Promise<void>((resolve) => {
    releaseHeld = resolve;
  });
};
const releaseQuote = async () => {
  state.quoteHeld = null;
  await act(async () => {
    releaseHeld?.();
  });
  await flush(4);
};

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
  state.quoteHeld = null;
  state.points = 0;
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  setDesktop(true);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan lg: lý do khoá nút Đặt hàng nằm cạnh nút (K2 c)', () => {
  it('chưa có địa chỉ: vùng role=status cạnh nút ghi lý do (chữ phụ, không đỏ), nút bấm được để chỉ ra chỗ thiếu', async () => {
    state.noAddress = true;
    const c = await mount();
    const region = note(c)!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.textContent).toBe('Chọn địa chỉ giao hàng để đặt hàng.');
    expect(region.className).toContain('--color-text-secondary');
    expect(region.className).not.toContain('danger');
    expect(lgButton(c).disabled).toBe(false);
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
    expect(errorNote(c)!.textContent).toBe('Giá ưu đãi đã thay đổi. Bạn cập nhật giá mới rồi đặt tiếp nhé.');
    expect(errorNote(c)!.getAttribute('aria-hidden')).toBe('true');
    expect(part(c).querySelector('[role="alert"]')).toBeNull();
    expect(c.querySelectorAll('[data-testid="checkout-price-changed"]')).toHaveLength(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(lgButton(c));
  });

  it('lỗi mà onError tải lại báo giá (nút còn khoá lúc trạng thái lỗi hiện ra): nút nhận focus ngay khi báo giá về, không bỏ sót', async () => {
    state.placeError = new Error('PRICE_CHANGED');
    const c = await mount();
    holdQuote();
    click(lgButton(c));
    await flush(4);
    expect(part(c).querySelector('[data-testid="place-error-lg"]')).not.toBeNull();
    expect(lgButton(c).disabled).toBe(true);
    await releaseQuote();
    expect(lgButton(c).disabled).toBe(false);
    expect(document.activeElement).toBe(lgButton(c));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('khách đã focus ô ghi chú (ngoài khung Đơn hàng) lúc báo giá tải lại: báo giá về thì focus ở lại ô, nút không giật focus (L5 1)', async () => {
    state.placeError = new Error('PRICE_CHANGED');
    const c = await mount();
    holdQuote();
    click(lgButton(c));
    await flush(4);
    expect(lgButton(c).disabled).toBe(true);
    const textarea = c.querySelector<HTMLTextAreaElement>('[data-mini-block="note"] textarea')!;
    textarea.focus();
    expect(document.activeElement).toBe(textarea);
    await releaseQuote();
    expect(lgButton(c).disabled).toBe(false);
    expect(document.activeElement).toBe(textarea);
    // Cờ đã hạ: các lần vẽ lại sau đó cũng không kéo focus về nút (Space/Enter kế tiếp không được bấm nhầm Đặt hàng).
    await flush(4);
    expect(document.activeElement).toBe(textarea);
  });

  // Báo giá về sau lúc khách đã chọn một chỗ trong khung "Đơn hàng" (không chỉ ô ngoài khung): focus ở lại, Space/Enter kế tiếp không bấm nhầm nút.
  const keepsFocus = async (c: HTMLElement, target: HTMLElement) => {
    target.focus();
    expect(document.activeElement).toBe(target);
    await releaseQuote();
    expect(lgButton(c).disabled).toBe(false);
    expect(document.activeElement).toBe(target);
    await flush(4);
    expect(document.activeElement).toBe(target);
  };
  const failWithSlowQuote = async () => {
    state.placeError = new Error('PRICE_CHANGED');
    const c = await mount();
    holdQuote();
    click(lgButton(c));
    await flush(4);
    expect(lgButton(c).disabled).toBe(true);
    return c;
  };

  it('khách đang gõ ô nhập mã giảm giá (trong khung Đơn hàng, bung tại chỗ từ lg) lúc báo giá về: focus ở lại ô, Enter kế tiếp không bấm nhầm Đặt hàng (L5 1)', async () => {
    const c = await failWithSlowQuote();
    const chooseCoupon = [...c.querySelectorAll<HTMLButtonElement>('[data-mini-block="coupon"] button')].find((b) => b.textContent?.includes('Chọn mã'))!;
    click(chooseCoupon);
    await flush(2);
    const input = c.querySelector<HTMLInputElement>('#coupon-code')!;
    expect(input).not.toBeNull();
    expect(input.closest('[data-mini-part="place-order"]')).toBeNull();
    await keepsFocus(c, input);
  });

  it('khách đang ở ô tick Điểm Xanh (trong khung Đơn hàng) lúc báo giá về: focus ở lại ô, Space kế tiếp không bấm nhầm Đặt hàng (L5 1)', async () => {
    state.points = 100;
    const c = await failWithSlowQuote();
    const checkbox = c.querySelector<HTMLInputElement>('[data-mini-block="points"] input[type="checkbox"]')!;
    expect(checkbox).not.toBeNull();
    await keepsFocus(c, checkbox);
  });

  it('khách đang ở liên kết "Đổi lựa chọn" trong khung Đơn hàng: focus ở lại, Enter là đi trang chứ không đặt hàng (L5 1)', async () => {
    sessionStorage.setItem('tubu_checkout_selection', JSON.stringify({ itemIds: ['i1'] }));
    const c = await failWithSlowQuote();
    const link = c.querySelector<HTMLAnchorElement>('[data-mini-block="items"] a[href="/gio-hang"]')!;
    expect(link).not.toBeNull();
    await keepsFocus(c, link);
  });

  it('khách đang ở liên kết Điều khoản ngay trên nút Đặt hàng: focus ở lại, không kéo về nút (L5 1)', async () => {
    const c = await failWithSlowQuote();
    await keepsFocus(c, part(c).querySelector<HTMLAnchorElement>('a[href="/chinh-sach/dieu-khoan"]')!);
  });

  it('focus bị mất vì nút khoá (body) khi báo giá về: nút Đặt hàng nhận lại focus (L5 1)', async () => {
    const c = await failWithSlowQuote();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    await releaseQuote();
    expect(document.activeElement).toBe(lgButton(c));
  });

  it('focus đã trả về nút một lần thì yêu cầu hết: các lần vẽ lại sau đó (lỗi cũ còn hiện) không kéo focus về nút nữa', async () => {
    state.placeError = new Error('Địa chỉ giao không hợp lệ.');
    const c = await mount();
    click(lgButton(c));
    await flush(6);
    expect(document.activeElement).toBe(lgButton(c));
    (document.activeElement as HTMLElement).blur();
    // Lỗi cũ vẫn hiện nhưng không còn yêu cầu focus nào chờ.
    await flush(4);
    expect(document.activeElement).not.toBe(lgButton(c));
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
