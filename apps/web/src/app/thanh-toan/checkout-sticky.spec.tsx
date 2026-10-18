// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// D7 việc 4: thanh toán trên điện thoại có thanh dính đáy (Tổng + nút "Đặt hàng · số tiền"), radio/checkbox ≥ 24px.

const state = vi.hoisted(() => ({
  placed: [] as Record<string, unknown>[],
  placeGate: null as Promise<void> | null,
  placeError: null as Error | null,
  quoteError: null as Error | null,
  noAddress: false,
  points: 0,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated', initialized: true }) }));
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
      : [
          { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: 'p', districtCode: '', wardCode: 'w', isDefault: true },
        ],
  checkoutQuote: async () => {
    if (state.quoteError) throw state.quoteError;
    return {
      subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 330000, pointsEarned: 0,
      pointsBalance: state.points, redeemablePoints: state.points,
    };
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
const bar = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="sticky-bar"]');
const barButton = (c: HTMLElement) => bar(c)!.querySelector<HTMLButtonElement>('button')!;

beforeEach(() => {
  sessionStorage.clear();
  state.placed = [];
  state.placeGate = null;
  state.placeError = null;
  state.quoteError = null;
  state.noAddress = false;
  state.points = 0;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan — thanh dính đáy', () => {
  it('hiện Tổng cộng và nút "Đặt hàng · số tiền" đúng báo giá', async () => {
    const c = await mount();
    expect(bar(c)!.textContent).toContain('Tổng cộng');
    expect(bar(c)!.textContent).toContain('330.000đ');
    expect(barButton(c).textContent).toBe('Đặt hàng · 330.000đ');
    expect(barButton(c).disabled).toBe(false);
  });

  it('bấm nút trên thanh dính đặt đúng đơn như nút trong khung tóm tắt', async () => {
    const c = await mount();
    click(barButton(c));
    await flush(6);
    expect(state.placed).toHaveLength(1);
    expect(c.textContent).toContain('Đặt hàng thành công');
    expect(bar(c)).toBeNull();
  });

  it('chưa có địa chỉ: tổng ghi "Chưa tính", nút khoá và không kèm số tiền', async () => {
    state.noAddress = true;
    const c = await mount();
    expect(bar(c)!.textContent).toContain('Chưa tính');
    expect(barButton(c).disabled).toBe(true);
    expect(barButton(c).textContent).toBe('Đặt hàng');
  });

  it('báo giá lỗi: không hiện số tiền cũ trên nút, nút khoá', async () => {
    state.quoteError = new Error('boom');
    const c = await mount();
    expect(barButton(c).disabled).toBe(true);
    expect(barButton(c).textContent).toBe('Đặt hàng');
  });

  it('đang đặt hàng: nút trên thanh dính đổi chữ và khoá (không đặt đôi)', async () => {
    let release!: () => void;
    state.placeGate = new Promise<void>((r) => (release = r));
    const c = await mount();
    click(barButton(c));
    await flush(3);
    expect(barButton(c).textContent).toBe('Đang đặt hàng…');
    expect(barButton(c).disabled).toBe(true);
    expect(state.placed).toHaveLength(1);
    release();
    await flush(6);
  });

  it('đặt hàng lỗi: lời báo hiện luôn trên thanh dính, khách không phải cuộn xuống cuối trang mới thấy', async () => {
    state.placeError = new Error('Địa chỉ giao không hợp lệ.');
    const c = await mount();
    click(barButton(c));
    await flush(6);
    expect(bar(c)!.textContent).toContain('Địa chỉ giao không hợp lệ.');
    expect(barButton(c).disabled).toBe(false);
  });

  it('trang vẫn còn nút "Đặt hàng" trong khung tóm tắt cho màn rộng', async () => {
    const c = await mount();
    const inCard = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Đặt hàng');
    expect(inCard).toBeDefined();
    expect(inCard!.className).toMatch(/\bhidden\b/);
    expect(inCard!.className).toMatch(/\bmd:inline-flex\b/);
  });

  it('vùng chạm 44px và mọi nút có tên', async () => {
    const c = await mount();
    expect(smallTouchTargets(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });
});

describe('/thanh-toan — radio/checkbox đủ lớn (≥ 24px)', () => {
  it('radio địa chỉ, radio thanh toán và ô dùng Điểm Xanh đều h-6 w-6', async () => {
    state.points = 50;
    const c = await mount();
    const controls = Array.from(c.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]'));
    expect(controls.length).toBeGreaterThanOrEqual(5);
    const small = controls.filter((el) => !/\bh-6\b/.test(el.className) || !/\bw-6\b/.test(el.className));
    expect(small.map((el) => el.outerHTML.slice(0, 100))).toEqual([]);
  });
});
