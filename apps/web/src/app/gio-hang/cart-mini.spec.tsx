// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Giỏ ở khổ điện thoại phải là Mini App (apps/miniapp/src/pages/cart.tsx): chữ, cách đếm, thẻ mã, thanh dính đáy.
// jsdom không có media query nên chỗ chỉ-điện-thoại kiểm bằng lớp `max-md:`/`md:`.

const state = vi.hoisted(() => ({ cart: null as unknown, coupons: [] as unknown[] }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => state.cart,
  getMyCoupons: async () => state.coupons,
  getCouponPreviews: async () => [],
  getCartSelection: async () => {
    throw new Error('chưa mock');
  },
}));

import CartPage from './page';

const line = (over: Record<string, unknown>) => ({
  id: 'i1', variationId: 'v1', productName: 'Serum dưỡng ẩm', variationName: '30ml', slug: 'serum', thumbnail: null,
  unitPrice: 289000, quantity: 2, stock: 9, total: 578000, ...over,
});
const cartOf = (items: unknown[], over: Record<string, unknown> = {}) => ({
  items, couponCode: null, subtotal: 578000, discount: 0, freeship: true, freeshipThreshold: 500000, itemCount: 2, ...over,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CartPage />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const bar = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="sticky-bar"]')!;

beforeEach(() => {
  sessionStorage.clear();
  state.cart = cartOf([line({})]);
  state.coupons = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/gio-hang — chữ và cách đếm như Mini App', () => {
  it('"Chọn tất cả" không kèm số dòng', async () => {
    const c = await mount();
    const label = c.querySelector('input[aria-label="Chọn tất cả sản phẩm"]')!.closest('label')!;
    expect(label.textContent?.trim()).toBe('Chọn tất cả');
  });

  it('D7-34: Thanh toán đếm số lượng (6), Chọn tất cả không đếm dòng', async () => {
    state.cart = cartOf(
      [line({ id: 'a', quantity: 3, total: 867000 }), line({ id: 'b', quantity: 2, total: 578000 }), line({ id: 'c', quantity: 1, total: 289000 })],
      { subtotal: 1734000 },
    );
    const c = await mount();
    expect(c.querySelector('label:has(input[aria-label="Chọn tất cả sản phẩm"])')!.textContent?.trim()).toBe('Chọn tất cả');
    expect(bar(c).querySelector('a[href="/thanh-toan"]')!.textContent).toBe('Thanh toán (6)');
  });

  it('nút xoá là icon thùng rác ở điện thoại, chữ "Xóa" chỉ từ md; thành tiền theo dòng chỉ từ md', async () => {
    const c = await mount();
    const del = c.querySelector<HTMLButtonElement>('button[aria-label="Xóa Serum dưỡng ẩm khỏi giỏ hàng"]')!;
    expect(del.querySelector('svg')).not.toBeNull();
    expect(del.querySelector('span')!.className).toMatch(/\bmax-md:hidden\b/);
    const total = Array.from(c.querySelectorAll<HTMLElement>('div')).find((d) => d.textContent === '578.000đ' && /flex-none/.test(d.className))!;
    expect(total.className).toMatch(/\bmax-md:hidden\b/);
  });
});

describe('/gio-hang — thẻ mã giảm giá như Mini App', () => {
  it('có phụ đề "Chọn hoặc nhập mã giảm giá" và "Chọn mã"', async () => {
    const c = await mount();
    const head = c.querySelector<HTMLButtonElement>('button[aria-controls="coupon-panel"]')!;
    expect(head.textContent).toContain('Mã giảm giá');
    expect(head.textContent).toContain('Chọn hoặc nhập mã giảm giá');
    expect(head.textContent).toContain('Chọn mã');
    expect(head.textContent).not.toContain('Bạn có');
  });
});

describe('/gio-hang — thanh dính đáy như Mini App', () => {
  it('đủ freeship: "Bạn được miễn phí ship 🌿", tạm tính (đã giảm, chưa gồm ship), một nút "Thanh toán (2)", không có Tổng cộng', async () => {
    const c = await mount();
    const b = bar(c).textContent!;
    expect(b).toContain('Bạn được miễn phí ship 🌿');
    expect(b).toContain('Tạm tính (đã giảm, chưa gồm ship)');
    expect(b).toContain('578.000đ');
    expect(b).not.toContain('Tổng cộng');
    expect(bar(c).querySelector('a[href="/thanh-toan"]')!.textContent).toBe('Thanh toán (2)');
  });

  it('chưa đủ freeship: câu mời mua thêm kèm thanh tiến độ theo phần trăm', async () => {
    state.cart = cartOf([line({ quantity: 1, total: 289000 })], { subtotal: 289000, freeship: false });
    const c = await mount();
    expect(bar(c).textContent).toContain('Mua thêm 211.000đ để được miễn phí ship');
    const fill = bar(c).querySelector<HTMLElement>('[data-testid="freeship-fill"]')!;
    expect(fill.style.width).toBe('58%');
  });

  it('bỏ chọn hết: thanh dính vẫn nhắc đúng ngưỡng freeship (như StickySummary của Mini App), không "Mua thêm 0đ"', async () => {
    state.cart = cartOf([line({ id: 'a', quantity: 1, total: 289000 }), line({ id: 'b', quantity: 1, total: 289000 })], { subtotal: 578000, freeship: true });
    const c = await mount();
    click(c.querySelector('input[aria-label="Chọn tất cả sản phẩm"]'));
    await flush(3);
    expect(bar(c).textContent).toContain('Mua thêm 500.000đ để được miễn phí ship');
  });

  it('các khoản giảm nằm trên thanh dính, tạm tính là số đã giảm', async () => {
    state.cart = cartOf([line({})], { discount: 50000, couponCode: 'XANH50' });
    const c = await mount();
    const b = bar(c).textContent!;
    expect(b).toContain('Giảm giá');
    expect(b).toContain('-50.000đ');
    expect(b).toContain('528.000đ');
  });

  it('khung tóm tắt trong thân trang ẩn ở điện thoại', async () => {
    const c = await mount();
    const card = c.querySelector('[data-testid="cart-summary"]')!;
    expect(card.className).toMatch(/\bmax-md:contents\b/);
    expect(card.querySelector('[data-testid="cart-summary-rows"]')!.className).toMatch(/\bmax-md:hidden\b/);
  });
});
