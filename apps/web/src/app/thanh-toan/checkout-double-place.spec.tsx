// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// W71B: nút Đặt hàng (khung tóm tắt từ lg và thanh dính đáy) khoá đồng bộ bằng ref: `place.isPending` chỉ đúng sau lần vẽ kế
// (React Query báo trạng thái qua setTimeout 0), nên hai cú bấm trong cùng một khung hình vẫn đều thấy nút bật và gửi hai đơn.
// Khi đang gửi nút giữ focus (aria-busy + aria-disabled, không `disabled` thật vì Chromium thả focus về body).

const state = vi.hoisted(() => ({
  placed: [] as Record<string, unknown>[],
  placeGate: null as Promise<void> | null,
  placeError: null as Error | null,
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
  getAddresses: async () => [
    { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true },
  ],
  checkoutQuote: async () => ({
    subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 330000, pointsEarned: 0,
    pointsBalance: 0, redeemablePoints: 0,
  }),
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
/** Hai cú bấm liên tiếp trước khi React vẽ lại: `click` của harness mở một `act` riêng cho mỗi cú nên không đủ nhanh. */
const pressTwice = (...els: HTMLElement[]) =>
  act(() => {
    for (const el of els) el.click();
  });
const hold = () => {
  let release!: () => void;
  state.placeGate = new Promise<void>((r) => (release = r));
  return () => release();
};

beforeEach(() => {
  sessionStorage.clear();
  state.placed = [];
  state.placeGate = null;
  state.placeError = null;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan — Đặt hàng khoá đồng bộ chống bấm đúp (W71B)', () => {
  it('hai cú bấm sát nhau vào nút ở khung tóm tắt (từ lg) chỉ gửi một đơn', async () => {
    const release = hold();
    const c = await mount();
    const btn = lgButton(c);
    pressTwice(btn, btn);
    await flush(3);
    expect(state.placed).toHaveLength(1);
    release();
    await flush(6);
    expect(state.placed).toHaveLength(1);
  });

  it('hai cú bấm sát nhau vào nút trên thanh dính đáy chỉ gửi một đơn', async () => {
    const release = hold();
    const c = await mount();
    const btn = barButton(c);
    pressTwice(btn, btn);
    await flush(3);
    expect(state.placed).toHaveLength(1);
    release();
    await flush(6);
    expect(state.placed).toHaveLength(1);
  });

  it('một cú ở khung tóm tắt rồi một cú ở thanh dính đáy: chung một khoá, chỉ một đơn', async () => {
    const release = hold();
    const c = await mount();
    pressTwice(lgButton(c), barButton(c));
    await flush(3);
    expect(state.placed).toHaveLength(1);
    release();
    await flush(6);
  });

  it('đang gửi: cả hai nút aria-busy + aria-disabled, không `disabled` thật (giữ focus), đổi chữ "Đang đặt hàng…"', async () => {
    const release = hold();
    const c = await mount();
    barButton(c).focus();
    click(barButton(c));
    await flush(3);
    for (const btn of [lgButton(c), barButton(c)]) {
      expect(btn.textContent).toBe('Đang đặt hàng…');
      expect(btn.getAttribute('aria-busy')).toBe('true');
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.disabled).toBe(false);
    }
    expect(document.activeElement).toBe(barButton(c));
    release();
    await flush(6);
  });

  it('đã đứng yên thì nút không mang aria-busy/aria-disabled', async () => {
    const c = await mount();
    for (const btn of [lgButton(c), barButton(c)]) {
      expect(btn.getAttribute('aria-busy')).toBeNull();
      expect(btn.getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('bấm lúc đang gửi (sau lần vẽ) cũng không gửi thêm đơn', async () => {
    const release = hold();
    const c = await mount();
    click(lgButton(c));
    await flush(3);
    click(lgButton(c));
    click(barButton(c));
    await flush(3);
    expect(state.placed).toHaveLength(1);
    release();
    await flush(6);
  });

  it('đặt lỗi thì nhả khoá và bỏ aria-busy: khách bấm lại được, vẫn chỉ MỘT đơn mỗi cú đôi', async () => {
    state.placeError = new Error('Địa chỉ giao không hợp lệ.');
    const c = await mount();
    click(lgButton(c));
    await flush(6);
    expect(state.placed).toHaveLength(1);
    expect(lgButton(c).getAttribute('aria-busy')).toBeNull();
    expect(lgButton(c).getAttribute('aria-disabled')).toBeNull();
    pressTwice(lgButton(c), lgButton(c));
    await flush(6);
    expect(state.placed).toHaveLength(2);
  });

  it('lỗi giữ nguyên báo cho khách (role=alert) và không bị nuốt khi nhả khoá', async () => {
    state.placeError = new Error('Địa chỉ giao không hợp lệ.');
    const c = await mount();
    click(barButton(c));
    await flush(6);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Địa chỉ giao không hợp lệ.');
  });

  it('hoá đơn thiếu ô: bấm chỉ chỉ ra ô thiếu, KHÔNG đặt khoá; điền đủ rồi bấm thì đặt được một đơn', async () => {
    const c = await mount();
    const field = (label: string) =>
      [...c.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input') as HTMLInputElement;
    click([...c.querySelectorAll('label')].find((l) => l.textContent?.includes('Yêu cầu xuất hoá đơn VAT'))!.querySelector('input[type="checkbox"]'));
    await flush(1);
    pressTwice(lgButton(c), lgButton(c));
    await flush(3);
    expect(state.placed).toHaveLength(0);
    expect(lgButton(c).getAttribute('aria-busy')).toBeNull();
    expect(field('Mã số thuế').getAttribute('aria-invalid')).toBe('true');
    typeInto(field('Mã số thuế'), '0312345678');
    typeInto(field('Tên công ty'), 'Công ty TNHH Tubu');
    typeInto(field('Địa chỉ xuất hoá đơn'), '1 Xuân Thuỷ, Cầu Giấy, Hà Nội');
    typeInto(field('Email nhận hoá đơn'), 'ketoan@tubutree.vn');
    await flush(1);
    click(lgButton(c));
    await flush(6);
    expect(state.placed).toHaveLength(1);
  });
});
