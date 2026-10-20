// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Giỏ ở khổ điện thoại phải là Mini App (apps/miniapp/src/pages/cart.tsx): chữ, cách đếm, thẻ mã, thanh dính đáy.
// jsdom không có media query nên chỗ chỉ-điện-thoại kiểm bằng lớp `max-md:`/`md:`.

const state = vi.hoisted(() => ({ cart: null as unknown, coupons: [] as unknown[], update: null as null | ((id: string, q: number) => Promise<unknown>) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => state.cart,
  getMyCoupons: async () => state.coupons,
  getCouponPreviews: async () => [],
  updateCartItem: (id: string, q: number) => state.update!(id, q),
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
  state.update = null;
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

describe('/gio-hang — dòng "Thành tiền" như Mini App (544c9ad7, 7edb9c02)', () => {
  const thanhTien = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('p, div, span')).filter((e) => e.children.length === 0 && /^Thành tiền /.test(e.textContent ?? ''));

  it('số lượng > 1: ghi "Thành tiền" theo line.total của máy chủ (không tự nhân), chỉ ở điện thoại', async () => {
    state.cart = cartOf([line({ quantity: 2, unitPrice: 289000, total: 500000 })], { subtotal: 500000 });
    const c = await mount();
    const rows = thanhTien(c);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toBe('Thành tiền 500.000đ');
    expect(rows[0]!.className).toMatch(/\bmd:hidden\b/);
  });

  it('số lượng 1: không có dòng "Thành tiền"', async () => {
    state.cart = cartOf([line({ quantity: 1, total: 289000 })], { subtotal: 289000 });
    expect(thanhTien(await mount())).toHaveLength(0);
  });

  it('lệnh PATCH số lượng của dòng đang chạy: ẩn "Thành tiền" cho tới khi máy chủ trả số mới', async () => {
    let done!: (v: unknown) => void;
    state.update = () => new Promise((r) => (done = r));
    state.cart = cartOf([line({ quantity: 2, total: 578000 })]);
    const c = await mount();
    expect(thanhTien(c)).toHaveLength(1);
    click(c.querySelector('button[aria-label="Tăng số lượng Serum dưỡng ẩm"]'));
    await flush(2);
    expect(thanhTien(c)).toHaveLength(0);
    done(cartOf([line({ quantity: 3, total: 867000 })], { subtotal: 867000 }));
    await flush(4);
    expect(thanhTien(c).map((e) => e.textContent)).toEqual(['Thành tiền 867.000đ']);
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
  it('đủ freeship: "Bạn được miễn phí giao hàng 🌿", tạm tính (đã giảm, chưa gồm phí giao hàng), một nút "Thanh toán (2)", không có Tổng cộng', async () => {
    const c = await mount();
    const b = bar(c).textContent!;
    expect(b).toContain('Bạn được miễn phí giao hàng 🌿');
    expect(b).toContain('Tạm tính (đã giảm, chưa gồm phí giao hàng)');
    expect(b).toContain('578.000đ');
    expect(b).not.toContain('Tổng cộng');
    expect(bar(c).querySelector('a[href="/thanh-toan"]')!.textContent).toBe('Thanh toán (2)');
  });

  it('có hàng gian hàng tự giao và phần Tubu giao đã đủ ngưỡng: "Miễn phí giao hàng cho phần hàng Tubu Tree giao"', async () => {
    state.cart = cartOf(
      [
        line({ id: 't1', quantity: 2, total: 578000, fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' } }),
        line({ id: 'm1', quantity: 1, total: 100000, fulfiller: { kind: 'MERCHANT', storefrontId: 'sf1', name: 'Mật ong Linh' } }),
      ],
      { subtotal: 678000, freeship: false },
    );
    const c = await mount();
    expect(bar(c).textContent).toContain('Miễn phí giao hàng cho phần hàng Tubu Tree giao');
  });

  it('chưa đủ freeship: câu mời mua thêm kèm thanh tiến độ theo phần trăm', async () => {
    state.cart = cartOf([line({ quantity: 1, total: 289000 })], { subtotal: 289000, freeship: false });
    const c = await mount();
    expect(bar(c).textContent).toContain('Mua thêm 211.000đ để được miễn phí giao hàng');
    const fill = bar(c).querySelector<HTMLElement>('[data-testid="freeship-fill"]')!;
    expect(fill.style.width).toBe('58%');
  });

  it('bỏ chọn hết: thanh dính vẫn nhắc đúng ngưỡng freeship (như StickySummary của Mini App), không "Mua thêm 0đ"', async () => {
    state.cart = cartOf([line({ id: 'a', quantity: 1, total: 289000 }), line({ id: 'b', quantity: 1, total: 289000 })], { subtotal: 578000, freeship: true });
    const c = await mount();
    click(c.querySelector('input[aria-label="Chọn tất cả sản phẩm"]'));
    await flush(3);
    expect(bar(c).textContent).toContain('Mua thêm 500.000đ để được miễn phí giao hàng');
  });

  it('dấu tick nằm trong khung 24px riêng bám đúng ô chọn (chọn tất cả và từng dòng)', async () => {
    const c = await mount();
    for (const input of Array.from(c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      const box = input.parentElement!;
      expect(box.tagName).toBe('SPAN');
      expect(box.className).toMatch(/\brelative\b/);
      expect(box.className).toMatch(/\bh-6\b/);
      expect(box.querySelector('svg')).not.toBeNull();
    }
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
