// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// K2 (P1 #2 của extra-critique-2): danh sách hàng ở khung "Đơn hàng" của web không còn vùng cuộn lồng; hiện đủ dòng,
// từ dòng thứ 6 gập sau nút "Xem thêm n sản phẩm" kèm tiền để các dòng thấy được cộng ra "Tạm tính".

const mocks = vi.hoisted(() => ({ count: 6, longName: false }));
const line = (n: number) => ({
  id: `i${n}`, variationId: `v${n}`,
  productName: mocks.longName ? `Nước rửa chén sinh học hương chanh sả gừng can lớn tiết kiệm cho gia đình đông người số ${n}` : `Sản phẩm ${n}`,
  variationName: n === 1 ? 'Can 5 lít' : null,
  slug: `sp-${n}`, thumbnail: null, unitPrice: n * 10_000, quantity: 1, stock: 9, total: n * 10_000,
});
const subtotal = () => Array.from({ length: mocks.count }, (_, i) => (i + 1) * 10_000).reduce((a, b) => a + b, 0);

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: Array.from({ length: mocks.count }, (_, i) => line(i + 1)),
    couponCode: null, subtotal: subtotal(), discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: mocks.count,
  }),
  getMyCoupons: async () => [],
  getAddresses: async () => [
    { id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: 'p', districtCode: '', wardCode: 'w', isDefault: true },
  ],
  checkoutQuote: async () => ({
    subtotal: subtotal(), discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000,
    total: subtotal() + 30000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
  }),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  mocks.count = 6;
  mocks.longName = false;
});

const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const list = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="region"][aria-label="Sản phẩm trong đơn"]')!;
const rows = (c: HTMLElement) => Array.from(list(c).querySelectorAll('[data-testid="checkout-line"]'));
const toggle = (c: HTMLElement) => list(c).querySelector<HTMLButtonElement>('button[aria-expanded]');
const money = (text: string) => Number((text.match(/[\d.]+(?=đ)/)?.[0] ?? '0').replace(/\./g, ''));

describe('/thanh-toan: danh sách hàng ở khung Đơn hàng (web, từ md)', () => {
  it('không còn vùng cuộn lồng: không overflow-auto, không max-h, không cần tabIndex để cuộn', async () => {
    const c = await mount();
    expect(list(c).className).not.toMatch(/overflow-/);
    expect(list(c).className).not.toMatch(/max-h-/);
    expect(list(c).hasAttribute('tabindex')).toBe(false);
  });

  it('6 dòng: hiện 5 dòng và nút "Xem thêm 1 sản phẩm" kèm tiền của dòng ẩn', async () => {
    const c = await mount();
    expect(rows(c)).toHaveLength(5);
    const btn = toggle(c)!;
    expect(btn.textContent).toContain('Xem thêm 1 sản phẩm');
    expect(btn.textContent).toContain('60.000đ');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('các dòng thấy được cộng với tiền dòng gập ra đúng "Tạm tính"', async () => {
    const c = await mount();
    const shown = rows(c).reduce((s, r) => s + money(r.lastElementChild!.textContent ?? ''), 0);
    const hidden = money(toggle(c)!.textContent ?? '');
    expect(shown + hidden).toBe(210_000);
    const tamTinh = Array.from(c.querySelectorAll('div.flex')).find((d) => d.firstElementChild?.textContent === 'Tạm tính');
    expect(money(tamTinh!.lastElementChild!.textContent ?? '')).toBe(210_000);
  });

  it('bấm "Xem thêm" mở đủ 6 dòng và nút đổi thành "Thu gọn"; bấm lại gập về 5', async () => {
    const c = await mount();
    click(toggle(c));
    await flush(2);
    expect(rows(c)).toHaveLength(6);
    expect(toggle(c)!.textContent).toBe('Thu gọn');
    expect(toggle(c)!.getAttribute('aria-expanded')).toBe('true');
    click(toggle(c));
    await flush(2);
    expect(rows(c)).toHaveLength(5);
  });

  it('đúng 5 dòng thì không có nút gập', async () => {
    mocks.count = 5;
    const c = await mount();
    expect(rows(c)).toHaveLength(5);
    expect(toggle(c)).toBeNull();
  });

  it('một dòng: không nút, phân loại ở phần tử riêng sau tên', async () => {
    mocks.count = 1;
    const c = await mount();
    expect(toggle(c)).toBeNull();
    const name = Array.from(list(c).querySelectorAll('span')).find((s) => s.textContent === 'Sản phẩm 1')!;
    const variation = Array.from(list(c).querySelectorAll('span')).find((s) => s.textContent === 'Can 5 lít')!;
    expect(name).toBeDefined();
    expect(variation).toBeDefined();
    expect(name.compareDocumentPosition(variation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(name.contains(variation)).toBe(false);
  });

  it('tên dài tiếng Việt có dấu: tối đa hai dòng (line-clamp-2), không cắt một dòng', async () => {
    mocks.count = 2;
    mocks.longName = true;
    const c = await mount();
    const name = Array.from(list(c).querySelectorAll('span')).find((s) => s.children.length === 0 && s.textContent?.startsWith('Nước rửa chén'))!;
    expect(name.className).toMatch(/\bline-clamp-2\b/);
    expect(name.className).not.toMatch(/\btruncate\b/);
  });
});
