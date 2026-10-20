// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { recallCheckoutSelection } from '@/lib/checkout-selection';

// D7 việc 4: giỏ hàng trên điện thoại có thanh dính đáy (tạm tính đã giảm + "Thanh toán (N)" như Mini App), checkbox ≥ 24px.

const state = vi.hoisted(() => ({ cart: null as unknown }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => state.cart,
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  getCartSelection: async () => {
    throw new Error('chưa mock');
  },
}));

import CartPage from './page';

const line = (over: Record<string, unknown>) => ({
  id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết', variationName: '500ml', slug: 'dau-goi', thumbnail: null,
  unitPrice: 150000, quantity: 2, stock: 5, total: 300000, ...over,
});
const cartOf = (items: unknown[], over: Record<string, unknown> = {}) => ({
  items, couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 2, ...over,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CartPage />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const bar = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="sticky-bar"]');

beforeEach(() => {
  sessionStorage.clear();
  state.cart = cartOf([line({})]);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/gio-hang — thanh dính đáy', () => {
  it('hiện tạm tính đã giảm và liên kết "Thanh toán (số lượng)" sang /thanh-toan', async () => {
    const c = await mount();
    expect(bar(c)!.textContent).toContain('Tạm tính (đã giảm, chưa gồm ship)300.000đ');
    const link = bar(c)!.querySelector<HTMLAnchorElement>('a[href="/thanh-toan"]')!;
    expect(link.textContent).toBe('Thanh toán (2)');
  });

  it('tổng trên thanh dính trừ các khoản giảm như khung tóm tắt', async () => {
    state.cart = cartOf([line({})], { discount: 50000, couponCode: 'XANH50' });
    const c = await mount();
    expect(bar(c)!.textContent).toContain('Tạm tính (đã giảm, chưa gồm ship)250.000đ');
  });

  it('bấm trên thanh dính cũng nhớ phần giỏ đang chọn (toàn giỏ khi chọn hết)', async () => {
    const c = await mount();
    const link = bar(c)!.querySelector<HTMLAnchorElement>('a[href="/thanh-toan"]')!;
    link.addEventListener('click', (e) => e.preventDefault());
    click(link);
    expect(recallCheckoutSelection()).toBeNull();
  });

  it('bỏ chọn một dòng: thanh dính nhớ đúng các dòng còn chọn và tính theo phần đó', async () => {
    state.cart = cartOf([line({}), line({ id: 'i2', productName: 'Xà phòng', unitPrice: 50000, quantity: 1, total: 50000 })], {
      subtotal: 350000,
      itemCount: 3,
    });
    const c = await mount();
    click(c.querySelector('input[aria-label="Chọn Xà phòng để thanh toán"]'));
    await flush(3);
    expect(bar(c)!.querySelector('a[href="/thanh-toan"]')!.textContent).toContain('Thanh toán (2)');
    const link = bar(c)!.querySelector<HTMLAnchorElement>('a[href="/thanh-toan"]')!;
    link.addEventListener('click', (e) => e.preventDefault());
    click(link);
    expect(recallCheckoutSelection()).toEqual(['i1']);
  });

  it('không chọn dòng nào: nút khoá, ghi rõ lý do', async () => {
    const c = await mount();
    click(c.querySelector('input[aria-label="Chọn tất cả sản phẩm"]'));
    await flush(3);
    const btn = bar(c)!.querySelector('button')!;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Thanh toán (0)');
    expect(bar(c)!.textContent).toContain('Chọn ít nhất một sản phẩm');
  });

  it('có dòng hết hàng: nút khoá và thanh dính nói luôn lý do', async () => {
    state.cart = cartOf([line({}), line({ id: 'i2', stock: 0, productName: 'Xà phòng' })]);
    const c = await mount();
    expect(bar(c)!.querySelector('a[href="/thanh-toan"]')).toBeNull();
    expect(bar(c)!.querySelector('button')!.disabled).toBe(true);
    expect(bar(c)!.textContent).toContain('hết hàng');
  });

  // Dưới md khung tóm tắt bị CSS ẩn (display:none, trình đọc màn hình cũng không thấy), nên lời báo vì sao nút khoá chỉ đến được
  // người dùng trình đọc màn hình qua thanh dính: không được aria-hidden và nút phải được mô tả bằng chính lời báo đó.
  it('hết hàng: lời báo trên thanh dính là thông báo cho trình đọc màn hình, gắn vào nút khoá bằng aria-describedby', async () => {
    state.cart = cartOf([line({}), line({ id: 'i2', stock: 0, productName: 'Xà phòng' })]);
    const c = await mount();
    const hint = bar(c)!.querySelector<HTMLElement>('[role="alert"]')!;
    expect(hint.textContent).toContain('hết hàng');
    expect(hint.closest('[aria-hidden="true"]')).toBeNull();
    const btn = bar(c)!.querySelector('button')!;
    expect(hint.id).not.toBe('');
    expect(btn.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('không chọn dòng nào: lời báo là role=status, nút khoá được mô tả bằng nó', async () => {
    const c = await mount();
    click(c.querySelector('input[aria-label="Chọn tất cả sản phẩm"]'));
    await flush(3);
    const hint = bar(c)!.querySelector<HTMLElement>('[role="status"]')!;
    expect(hint.textContent).toContain('Chọn ít nhất một sản phẩm');
    expect(hint.closest('[aria-hidden="true"]')).toBeNull();
    expect(bar(c)!.querySelector('button')!.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('mỗi lúc chỉ một bản lời báo lộ ra: bản trong khung tóm tắt nằm trong khối hidden (chỉ từ md), thanh dính md:hidden', async () => {
    state.cart = cartOf([line({}), line({ id: 'i2', stock: 0, productName: 'Xà phòng' })]);
    const c = await mount();
    const hints = Array.from(c.querySelectorAll<HTMLElement>('[role="alert"]')).filter((el) => el.textContent?.includes('hết hàng'));
    const inCard = hints.find((el) => !bar(c)!.contains(el))!;
    expect(inCard.closest('.hidden')?.className).toMatch(/\bmd:block\b/);
    expect(bar(c)!.className).toMatch(/\bmd:hidden\b/);
  });

  it('có thể mua: không có lời báo và nút không mang aria-describedby', async () => {
    const c = await mount();
    expect(bar(c)!.querySelector('[role="alert"], [role="status"]')).toBeNull();
    expect(bar(c)!.querySelector('a[href="/thanh-toan"]')!.hasAttribute('aria-describedby')).toBe(false);
  });

  it('giỏ trống hoặc chưa tải: không có thanh dính', async () => {
    state.cart = cartOf([]);
    const c = await mount();
    expect(bar(c)).toBeNull();
  });

  it('vùng chạm 44px và mọi nút có tên', async () => {
    const c = await mount();
    expect(smallTouchTargets(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });
});

describe('/gio-hang — checkbox đủ lớn (≥ 24px)', () => {
  it('ô chọn tất cả và ô chọn từng dòng đều h-6 w-6', async () => {
    const c = await mount();
    const boxes = Array.from(c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes.length).toBe(2);
    expect(boxes.filter((b) => !/\bh-6\b/.test(b.className) || !/\bw-6\b/.test(b.className))).toEqual([]);
  });
});
