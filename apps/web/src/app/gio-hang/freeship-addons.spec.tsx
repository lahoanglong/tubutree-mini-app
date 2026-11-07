// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Thanh Miễn phí giao hàng và dải món bù đơn ở ĐẦU Giỏ (W42A). shop-client và core-http là bản giả; thanh, dải, query và mutation là bản thật.
const state = vi.hoisted(() => ({
  cart: null as unknown,
  best: null as unknown,
  bestError: false,
  add: null as null | ((variationId: string, qty: number) => Promise<unknown>),
  addCalls: [] as [string, number][],
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      if (path === '/products') {
        if (state.bestError) throw new Error('mạng');
        return state.best;
      }
      throw new Error(`đường dẫn lạ ${path}`);
    },
  },
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => state.cart,
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  addToCart: (variationId: string, qty: number) => {
    state.addCalls.push([variationId, qty]);
    return state.add!(variationId, qty);
  },
}));

import CartPage from './page';

const line = (over: Record<string, unknown> = {}) => ({
  id: 'i1', variationId: 'v-line', productName: 'Serum dưỡng ẩm', variationName: '30ml', slug: 'serum', thumbnail: null,
  unitPrice: 289000, quantity: 1, stock: 9, total: 289000, ...over,
});
const cartOf = (items: unknown[], over: Record<string, unknown> = {}) => {
  const subtotal = (items as { total: number }[]).reduce((s, it) => s + it.total, 0);
  return { items, couponCode: null, subtotal, discount: 0, freeship: subtotal >= 500000, freeshipThreshold: 500000, itemCount: items.length, ...over };
};
const card = (slug: string, price: number, over: Record<string, unknown> = {}) => ({
  id: slug, slug, brand: 'Tubu', name: `Món ${slug}`, thumbnail: null, basePrice: price, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${slug}`, ...over,
});
const best = (cards: unknown[]) => ({ data: cards, meta: { page: 1, limit: 10, total: cards.length } });
// Còn thiếu 211.000: món 230.000 đóng được khoảng thiếu (xếp đầu), 50.000 và 120.000 là món rẻ hơn khoảng thiếu, 300.000 vượt cửa sổ 25.000 nên bị loại.
const BEST = best([card('a', 50000), card('b', 120000), card('c', 230000), card('d', 300000)]);

let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<CartPage />);
  await flush(8);
  return mounted.container;
};
const q = (c: ParentNode, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const qa = (c: ParentNode, id: string) => Array.from(c.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
const slugs = (c: ParentNode) => qa(c, 'freeship-addon').map((e) => e.dataset.slug);

beforeEach(() => {
  sessionStorage.clear();
  state.cart = cartOf([line()]);
  state.best = BEST;
  state.bestError = false;
  state.addCalls = [];
  state.add = async () => state.cart;
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('/gio-hang — thanh Miễn phí giao hàng + dải món bù đơn (W42A)', () => {
  it('thanh nằm ĐẦU nội dung giỏ (trên "Chọn tất cả"), dải gợi ý ngay dưới thanh', async () => {
    const c = await mount();
    const bar = q(c, 'freeship-progress')!;
    const rail = q(c, 'freeship-addons')!;
    const selectAll = c.querySelector('input[aria-label="Chọn tất cả sản phẩm"]')!;
    expect(bar.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rail.compareDocumentPosition(selectAll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q(c, 'cart-freeship')!.contains(bar) && q(c, 'cart-freeship')!.contains(rail)).toBe(true);
    expect(qa(c, 'freeship-progress')).toHaveLength(1);
  });

  it('thứ tự gợi ý: món đóng được khoảng thiếu trước, rồi các món rẻ hơn; món vượt cửa sổ giá bị loại', async () => {
    const c = await mount();
    expect(slugs(c)).toEqual(['c', 'a', 'b']);
  });

  it('món đã có trong giỏ (theo slug hoặc phân loại) không được gợi ý lại', async () => {
    state.cart = cartOf([line(), line({ id: 'i2', slug: 'a', variationId: 'v-a', total: 1, unitPrice: 1 })], { freeship: false, subtotal: 289000 });
    state.best = best([card('a', 50000), card('b', 120000), card('c', 230000), card('e', 100000, { slug: 'e2', repVariationId: 'v-line' }), card('f', 90000)]);
    const c = await mount();
    expect(slugs(c)).toEqual(['c', 'b', 'f']);
  });

  it('dưới 3 món hợp lệ thì dải ẩn hẳn, thanh vẫn hiện', async () => {
    state.best = best([card('a', 50000), card('b', 120000), card('d', 300000)]);
    const c = await mount();
    expect(q(c, 'freeship-addons')).toBeNull();
    expect(q(c, 'freeship-progress')).not.toBeNull();
  });

  it('API gợi ý lỗi: dải ẩn, giỏ vẫn dùng được (dòng hàng, thanh, nút Thanh toán)', async () => {
    state.bestError = true;
    const c = await mount();
    expect(q(c, 'freeship-addons')).toBeNull();
    expect(q(c, 'freeship-progress')!.textContent).toContain('Mua thêm 211.000đ');
    expect(qa(c, 'cart-line')).toHaveLength(1);
    expect(q(c, 'sticky-bar')!.querySelector('a[href="/thanh-toan"]')).not.toBeNull();
  });

  it('món Giờ vàng/khuyến mãi: gợi ý ghi đúng giá thẻ khách trả; nút có aria-label tên và giá', async () => {
    state.best = best([card('a', 50000, { salePrice: 40000 }), card('b', 120000), card('c', 230000)]);
    const c = await mount();
    const a = qa(c, 'freeship-addon').find((e) => e.dataset.slug === 'a')!;
    expect(a.textContent).toContain('40.000đ');
    expect(a.querySelector('[data-testid="freeship-add"]')!.getAttribute('aria-label')).toBe('Thêm Món a vào giỏ, 40.000đ');
  });

  it('một chạm "+ Thêm": đúng phân loại, số lượng 1, giỏ cập nhật theo máy chủ, thanh đổi mức, món vừa thêm rời dải', async () => {
    state.add = async () => cartOf([line(), line({ id: 'i2', slug: 'a', variationId: 'v-a', productName: 'Món a', unitPrice: 50000, total: 50000 })]);
    const c = await mount();
    expect(q(c, 'freeship-fill')!.style.width).toBe('57%');
    click(qa(c, 'freeship-add')[1]!);
    await flush(6);
    expect(state.addCalls).toEqual([['v-a', 1]]);
    expect(q(c, 'freeship-fill')!.style.width).toBe('67%');
    expect(q(c, 'freeship-progress')!.textContent).toContain('Mua thêm 161.000đ');
    expect(qa(c, 'cart-line')).toHaveLength(2);
    expect(slugs(c)).not.toContain('a');
  });

  it('bấm liên tiếp trong lúc đang thêm: nút khoá, chỉ một lệnh', async () => {
    let done!: (v: unknown) => void;
    state.add = () => new Promise((r) => (done = r));
    const c = await mount();
    const btn = qa(c, 'freeship-add')[0]!;
    click(btn);
    await flush(2);
    expect((qa(c, 'freeship-add')[0] as HTMLButtonElement).disabled).toBe(true);
    expect(qa(c, 'freeship-add')[0]!.getAttribute('aria-busy')).toBe('true');
    click(qa(c, 'freeship-add')[0]!);
    click(qa(c, 'freeship-add')[1]!);
    expect(state.addCalls).toHaveLength(1);
    await act(async () => done(cartOf([line(), line({ id: 'i2', slug: 'c', variationId: 'v-c', total: 230000, unitPrice: 230000 })])));
    await flush(4);
    expect(state.addCalls).toHaveLength(1);
  });

  it('đạt ngưỡng sau khi thêm: thanh chuyển sang chúc mừng (không còn thanh), dải thu lại', async () => {
    state.add = async () => cartOf([line(), line({ id: 'i2', slug: 'c', variationId: 'v-c', productName: 'Món c', unitPrice: 230000, total: 230000 })]);
    const c = await mount();
    expect(q(c, 'freeship-progress')!.dataset.reached).toBe('false');
    click(qa(c, 'freeship-add')[0]!);
    await flush(6);
    expect(q(c, 'freeship-progress')!.dataset.reached).toBe('true');
    expect(q(c, 'freeship-progress')!.textContent).toBe('🎉 Đơn hàng đã được Miễn phí giao hàng');
    expect(q(c, 'freeship-bar')).toBeNull();
    expect(q(c, 'freeship-addons')).toBeNull();
  });

  it('thêm lỗi: báo lỗi role=alert, giỏ không đổi, nút mở lại', async () => {
    state.add = async () => {
      throw new Error('Không thêm được');
    };
    const c = await mount();
    click(qa(c, 'freeship-add')[0]!);
    await flush(6);
    expect(c.querySelector('[data-testid="cart-freeship"] [role="alert"]')).not.toBeNull();
    expect(qa(c, 'cart-line')).toHaveLength(1);
    expect(q(c, 'freeship-fill')!.style.width).toBe('57%');
    expect((qa(c, 'freeship-add')[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it('đã đủ ngưỡng từ đầu: chỉ có dòng chúc mừng, không gợi ý, không gọi thêm giỏ', async () => {
    state.cart = cartOf([line({ unitPrice: 600000, total: 600000 })]);
    const c = await mount();
    expect(q(c, 'freeship-progress')!.dataset.reached).toBe('true');
    expect(q(c, 'freeship-addons')).toBeNull();
    expect(state.addCalls).toHaveLength(0);
  });

  it('bỏ chọn hết: thanh tính theo phần đang chọn (thiếu đủ ngưỡng, thanh 0%)', async () => {
    const c = await mount();
    click(c.querySelector('input[aria-label="Chọn tất cả sản phẩm"]'));
    await flush(3);
    expect(q(c, 'freeship-progress')!.textContent).toContain('Mua thêm 500.000đ');
    expect(q(c, 'freeship-fill')!.style.width).toBe('0%');
  });

  it('có hàng gian hàng tự giao: thanh chỉ tính phần Tubu giao và nói rõ điều đó', async () => {
    state.cart = cartOf(
      [
        line({ id: 't1', total: 289000, fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' } }),
        line({ id: 'm1', slug: 'mat-ong', variationId: 'v-mo', total: 400000, unitPrice: 400000, fulfiller: { kind: 'MERCHANT', storefrontId: 'sf1', name: 'Mật ong Linh' } }),
      ],
      { freeship: false },
    );
    const c = await mount();
    expect(q(c, 'freeship-progress')!.textContent).toContain('Mua thêm 211.000đ để được Miễn phí giao hàng cho phần hàng Tubu Tree giao');
  });

  it('gợi ý bỏ qua món do gian hàng tự giao hoặc tạm nghỉ', async () => {
    state.best = best([
      card('a', 50000, { fulfiller: { kind: 'MERCHANT', name: 'Linh', shippingFee: null, freeShipFrom: null } }),
      card('b', 120000),
      card('c', 230000),
      card('f', 90000),
    ]);
    const c = await mount();
    expect(slugs(c)).toEqual(['c', 'b', 'f']);
  });
});
