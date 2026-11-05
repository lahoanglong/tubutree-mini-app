// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };

const m = vi.hoisted(() => ({ addresses: [] as unknown[], placeOrder: vi.fn() }));

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
  getAddresses: async () => m.addresses,
  checkoutQuote: async () => QUOTE,
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
const placeButton = (r: Rendered) => byText(r.container, 'button', /^Đặt hàng/) as HTMLButtonElement;
const checkbox = (r: Rendered, label: string) =>
  [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input[type="checkbox"]') as HTMLInputElement;
const field = (r: Rendered, label: string) =>
  [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input') as HTMLInputElement;
const blur = (el: Element) => act(() => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
const describedBy = (el: Element) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? null;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.addresses = [ADDR];
  m.placeOrder.mockReset().mockReturnValue(new Promise(() => undefined));
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — lỗi ô nhập và nút đặt hàng bấm được (hk)', () => {
  it('chưa có địa chỉ: nút bấm được, bấm không gửi đơn, báo thiếu dưới khối địa chỉ và con trỏ vào khối đó', async () => {
    m.addresses = [];
    const r = await mount();
    expect(placeButton(r).disabled).toBe(false);
    click(placeButton(r));
    await flush(4);
    const block = r.container.querySelector('[data-testid="checkout-address-block"]')!;
    const alert = document.getElementById(block.getAttribute('aria-describedby') ?? '');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('Chọn địa chỉ giao hàng để đặt hàng.');
    expect(block.contains(document.activeElement)).toBe(true);
    expect(m.placeOrder).not.toHaveBeenCalled();
  });

  it('hoá đơn thiếu ô: bấm không gửi đơn, mỗi ô báo riêng (aria-invalid + aria-describedby), ô đầu tiên nhận con trỏ', async () => {
    const r = await mount();
    click(checkbox(r, 'Yêu cầu xuất hoá đơn VAT'));
    await flush(1);
    expect(field(r, 'Mã số thuế').getAttribute('aria-invalid')).toBeNull();
    expect(placeButton(r).disabled).toBe(false);
    click(placeButton(r));
    await flush(4);
    const tax = field(r, 'Mã số thuế');
    expect(tax.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(tax)).toContain('Nhập mã số thuế.');
    expect(describedBy(field(r, 'Tên công ty'))).toContain('Nhập tên công ty.');
    expect(describedBy(field(r, 'Địa chỉ xuất hoá đơn'))).toContain('Nhập địa chỉ xuất hoá đơn.');
    expect(describedBy(field(r, 'Email nhận hoá đơn'))).toContain('Nhập email nhận hoá đơn.');
    expect(document.activeElement).toBe(tax);
    expect(m.placeOrder).not.toHaveBeenCalled();
  });

  it('hoá đơn: rời ô có giá trị sai thì báo ngay dưới ô đó, ô chưa chạm chưa báo; sửa đúng thì hết báo và đặt được', async () => {
    const r = await mount();
    click(checkbox(r, 'Yêu cầu xuất hoá đơn VAT'));
    await flush(1);
    typeInto(field(r, 'Email nhận hoá đơn'), 'khong-phai-email');
    expect(field(r, 'Email nhận hoá đơn').getAttribute('aria-invalid')).toBeNull();
    blur(field(r, 'Email nhận hoá đơn'));
    await flush(1);
    expect(field(r, 'Email nhận hoá đơn').getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(field(r, 'Email nhận hoá đơn'))).toContain('Email chưa đúng.');
    expect(field(r, 'Tên công ty').getAttribute('aria-invalid')).toBeNull();
    typeInto(field(r, 'Mã số thuế'), '0312345678');
    typeInto(field(r, 'Tên công ty'), 'Công ty A');
    typeInto(field(r, 'Địa chỉ xuất hoá đơn'), '1 Phố Huế, Hà Nội');
    typeInto(field(r, 'Email nhận hoá đơn'), 'ketoan@a.vn');
    await flush(1);
    expect(field(r, 'Email nhận hoá đơn').getAttribute('aria-invalid')).toBeNull();
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder).toHaveBeenCalledTimes(1);
  });
});
