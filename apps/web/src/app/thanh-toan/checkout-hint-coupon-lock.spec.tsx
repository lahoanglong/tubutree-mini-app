// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// W91B (Mini W92A): khách chạm "Áp mã" ở dải gợi ý trong Giỏ rồi sang Thanh toán ngay. Trang giỏ gỡ đi nhưng lệnh áp mã vẫn
// bay; nút Đặt hàng phải đọc khoá chung của mọi lệnh đổi mã (`COUPON_MUTATION_KEY`) để chờ, không thì đơn đi với giỏ chưa có mã.

const state = vi.hoisted(() => ({
  couponCode: null as string | null,
  applyGate: null as Promise<void> | null,
  applyCalls: [] as string[],
  quoteCalls: 0,
}));
const SUBTOTAL = 300000;
const cartNow = () => ({
  items: [
    { id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 150000, quantity: 2, stock: 5, total: SUBTOTAL },
  ],
  couponCode: state.couponCode,
  subtotal: SUBTOTAL,
  discount: state.couponCode ? 90000 : 0,
  freeship: false,
  freeshipThreshold: 500000,
  itemCount: 2,
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u', walletBalance: 0, pointsBalance: 0 }, status: 'authenticated', initialized: true }),
}));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => cartNow(),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  applyCoupon: async (code: string) => {
    state.applyCalls.push(code);
    await state.applyGate;
    state.couponCode = code;
    return cartNow();
  },
  getAddresses: async () => [
    { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true },
  ],
  checkoutQuote: async () => {
    state.quoteCalls += 1;
    const discount = state.couponCode ? 90000 : 0;
    return {
      subtotal: SUBTOTAL, discount, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: SUBTOTAL - discount + 30000,
      pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
    };
  },
}));

import CheckoutPage from './page';
import { useCartVoucherHint } from '@/lib/use-cart-voucher-hint';

/** Dải gợi ý của trang Giỏ: bấm mã gọi đúng `apply` của hook; `leave` là rời trang Giỏ sang Thanh toán (hook bị gỡ, lệnh còn bay). */
function CartThenCheckout() {
  const [onCart, setOnCart] = useState(true);
  return (
    <>
      {onCart && <HintStrip />}
      <button data-testid="leave" type="button" onClick={() => setOnCart(false)} />
      <CheckoutPage />
    </>
  );
}
function HintStrip() {
  const hint = useCartVoucherHint({ currentCode: null, subtotal: SUBTOTAL, preview: { storefrontSlug: undefined, itemIds: undefined }, previewKey: 'k' });
  return <button data-testid="hint-apply" type="button" onClick={() => hint.apply('GIAM30')} />;
}

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CartThenCheckout />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const lgButton = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-mini-part="place-order"] button')!;
const barButton = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="sticky-bar"]')!.querySelector<HTMLButtonElement>('button')!;
const pointer = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const hold = () => {
  let release!: () => void;
  state.applyGate = new Promise<void>((r) => (release = r));
  return () => release();
};

beforeEach(() => {
  sessionStorage.clear();
  state.couponCode = null;
  state.applyGate = null;
  state.applyCalls = [];
  state.quoteCalls = 0;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan — Đặt hàng chờ lệnh áp mã từ dải gợi ý của Giỏ (W91B)', () => {
  it('đang đứng yên: cả hai nút Đặt hàng bấm được', async () => {
    const c = await mount();
    expect(lgButton(c).disabled).toBe(false);
    expect(barButton(c).disabled).toBe(false);
  });

  it('lệnh áp mã của dải gợi ý còn bay: cả hai nút Đặt hàng khoá, xong và báo giá mới về thì mở', async () => {
    const c = await mount();
    const release = hold();
    click(pointer(c, 'hint-apply'));
    await flush(3);
    expect(state.applyCalls).toEqual(['GIAM30']);
    expect(lgButton(c).disabled).toBe(true);
    expect(barButton(c).disabled).toBe(true);
    release();
    await flush(10);
    expect(lgButton(c).disabled).toBe(false);
    expect(barButton(c).disabled).toBe(false);
  });

  it('rời trang Giỏ khi lệnh còn bay (hook bị gỡ): nút Đặt hàng ở Thanh toán vẫn khoá tới khi lệnh xong', async () => {
    const c = await mount();
    const release = hold();
    click(pointer(c, 'hint-apply'));
    await flush(3);
    click(pointer(c, 'leave'));
    await flush(3);
    expect(pointer(c, 'hint-apply')).toBeNull();
    expect(lgButton(c).disabled).toBe(true);
    expect(barButton(c).disabled).toBe(true);
    release();
    await flush(10);
    expect(lgButton(c).disabled).toBe(false);
  });
});
