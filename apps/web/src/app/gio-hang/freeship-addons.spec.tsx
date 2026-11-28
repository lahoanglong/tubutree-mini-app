// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

// Thanh Miễn phí giao hàng và dải món bù đơn ở ĐẦU Giỏ (W42A). shop-client và core-http là bản giả; thanh, dải, query và mutation là bản thật.
const state = vi.hoisted(() => ({
  cart: null as unknown,
  gate: null as null | Promise<unknown>,
  best: null as unknown,
  bestError: false,
  cartGets: 0,
  bestGets: 0,
  bestGate: null as null | Promise<unknown>,
  add: null as null | ((variationId: string, qty: number) => Promise<unknown>),
  update: null as null | ((id: string, qty: number) => Promise<unknown>),
  addCalls: [] as [string, number][],
  push: vi.fn(),
  // Cấu hình công khai: null = lỗi (dải cũ từ kệ Bán chạy, như các ca W42A); có giá trị = cờ đọc được.
  config: null as unknown,
  upsell: [] as unknown,
  upsellError: false,
  upsellCalls: [] as unknown[],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push, replace: vi.fn() }), usePathname: () => '/gio-hang' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string, opts?: { query?: unknown }) => {
      if (path === '/config/public') {
        if (!state.config) throw new Error('mạng');
        return state.config;
      }
      if (path === '/upsell/freeship') {
        state.upsellCalls.push(opts?.query);
        if (state.upsellError) throw new Error('mạng');
        return state.upsell;
      }
      if (path === '/products') {
        state.bestGets += 1;
        if (state.bestGate) await state.bestGate;
        if (state.bestError) throw new Error('mạng');
        return state.best;
      }
      throw new Error(`đường dẫn lạ ${path}`);
    },
  },
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => {
    state.cartGets += 1;
    if (state.gate) await state.gate;
    return state.cart;
  },
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  updateCartItem: (id: string, qty: number) => state.update!(id, qty),
  addToCart: (variationId: string, qty: number) => {
    state.addCalls.push([variationId, qty]);
    return state.add!(variationId, qty);
  },
}));

import CartPage from './cart-page';

const line = (over: Record<string, unknown> = {}) => ({
  id: 'i1', variationId: 'v-line', productName: 'Serum dưỡng ẩm', variationName: '30ml', slug: 'serum', thumbnail: null,
  unitPrice: 289000, quantity: 1, stock: 9, total: 289000, ...over,
});
const cartOf = (items: unknown[], over: Record<string, unknown> = {}) => {
  const subtotal = (items as { total: number }[]).reduce((s, it) => s + it.total, 0);
  return { items, couponCode: null, subtotal, discount: 0, freeship: subtotal >= 340000, freeshipThreshold: 340000, itemCount: items.length, ...over };
};
const card = (slug: string, price: number, over: Record<string, unknown> = {}) => ({
  id: slug, slug, brand: 'Tubu', name: `Món ${slug}`, thumbnail: null, basePrice: price, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${slug}`, ...over,
});
const best = (cards: unknown[]) => ({ data: cards, meta: { page: 1, limit: 10, total: cards.length } });
// Còn thiếu 51.000 (giỏ 289.000, mốc 340.000): món 60.000 đóng được khoảng thiếu (xếp đầu), 30.000 và 10.000 là món gần đủ (đắt trước), 100.000 vượt cửa sổ 25.000 nên bị loại.
const BEST = best([card('a', 30000), card('b', 10000), card('c', 60000), card('d', 100000)]);

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
  state.cartGets = 0;
  state.bestGets = 0;
  state.bestGate = null;
  state.gate = null;
  state.addCalls = [];
  state.push.mockClear();
  state.add = async () => state.cart;
  state.update = async () => state.cart;
  state.config = null;
  state.upsell = [];
  state.upsellError = false;
  state.upsellCalls = [];
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

  it('tubu-w8-01: nguồn món còn tải thì khung chờ giữ đúng chỗ của dải (trong khối thanh, trên "Chọn tất cả", cùng tiêu đề); món về thì dải thay khung', async () => {
    let open!: () => void;
    state.bestGate = new Promise<void>((r) => (open = r));
    const c = await mount();
    const pending = q(c, 'freeship-addons-pending')!;
    expect(pending).not.toBeNull();
    expect(pending.getAttribute('aria-hidden')).toBe('true');
    expect(q(c, 'cart-freeship')!.contains(pending)).toBe(true);
    expect(pending.compareDocumentPosition(c.querySelector('input[aria-label="Chọn tất cả sản phẩm"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Khung chờ là đúng dòng gập 44px của dải (w47-01), cùng chữ: dải về không làm danh sách nhảy.
    expect(pending.textContent).toBe('Gợi ý thêm để được Miễn phí giao hàng');
    expect(pending.querySelector('.tubu-addon-toggle')).not.toBeNull();
    expect(pending.className).toBe(q(c, 'cart-freeship')!.querySelector('.tubu-addon')!.className);
    expect(q(c, 'freeship-addons')).toBeNull();
    await act(async () => open());
    await flush(6);
    expect(q(c, 'freeship-addons-pending')).toBeNull();
    expect(slugs(c)).toEqual(['c', 'a']);
  });

  it('tubu-w8-01: nguồn về mà dưới 2 món hợp lệ thì khung chờ thu lại, không để khối rỗng', async () => {
    let open!: () => void;
    state.bestGate = new Promise<void>((r) => (open = r));
    state.best = best([card('a', 30000)]);
    const c = await mount();
    expect(q(c, 'freeship-addons-pending')).not.toBeNull();
    await act(async () => open());
    await flush(6);
    expect(q(c, 'freeship-addons-pending')).toBeNull();
    expect(q(c, 'freeship-addons')).toBeNull();
  });

  it('thứ tự gợi ý: món đóng được khoảng thiếu trước, rồi các món rẻ hơn; món vượt cửa sổ giá bị loại', async () => {
    const c = await mount();
    expect(slugs(c)).toEqual(['c', 'a']);
  });

  it('món đã có trong giỏ (theo slug hoặc phân loại) không được gợi ý lại', async () => {
    state.cart = cartOf([line(), line({ id: 'i2', slug: 'a', variationId: 'v-a', total: 1, unitPrice: 1 })], { freeship: false, subtotal: 289000 });
    state.best = best([card('a', 30000), card('b', 10000), card('c', 60000), card('e', 20000, { slug: 'e2', repVariationId: 'v-line' }), card('f', 5000)]);
    const c = await mount();
    expect(slugs(c)).toEqual(['c', 'b']);
  });

  it('dưới 2 món hợp lệ thì dải ẩn hẳn, thanh vẫn hiện', async () => {
    state.best = best([card('a', 30000), card('d', 100000)]);
    const c = await mount();
    expect(q(c, 'freeship-addons')).toBeNull();
    expect(q(c, 'freeship-progress')).not.toBeNull();
  });

  it('API gợi ý lỗi: dải ẩn, giỏ vẫn dùng được (dòng hàng, thanh, nút Thanh toán)', async () => {
    state.bestError = true;
    const c = await mount();
    expect(q(c, 'freeship-addons')).toBeNull();
    expect(q(c, 'freeship-progress')!.textContent).toContain('Mua thêm 51.000đ');
    expect(qa(c, 'cart-line')).toHaveLength(1);
    expect(q(c, 'sticky-bar')!.querySelector('a[href="/thanh-toan"]')).not.toBeNull();
  });

  it('món Giờ vàng/khuyến mãi: gợi ý ghi đúng giá thẻ khách trả; nút có aria-label tên và giá', async () => {
    state.best = best([card('a', 30000, { salePrice: 24000 }), card('b', 10000), card('c', 60000)]);
    const c = await mount();
    const a = qa(c, 'freeship-addon').find((e) => e.dataset.slug === 'a')!;
    expect(a.textContent).toContain('24.000đ');
    expect(a.querySelector('[data-testid="freeship-add"]')!.getAttribute('aria-label')).toBe('Thêm Món a vào giỏ, 24.000đ');
  });

  it('một chạm "+ Thêm": đúng phân loại, số lượng 1, giỏ cập nhật theo máy chủ, thanh đổi mức, món vừa thêm rời dải', async () => {
    state.add = async () => cartOf([line(), line({ id: 'i2', slug: 'a', variationId: 'v-a', productName: 'Món a', unitPrice: 30000, total: 30000 })]);
    const c = await mount();
    expect(q(c, 'freeship-fill')!.style.width).toBe('85%');
    click(qa(c, 'freeship-add')[1]!);
    await flush(6);
    expect(state.addCalls).toEqual([['v-a', 1]]);
    expect(q(c, 'freeship-fill')!.style.width).toBe('93%');
    expect(q(c, 'freeship-progress')!.textContent).toContain('Mua thêm 21.000đ');
    expect(qa(c, 'cart-line')).toHaveLength(2);
    expect(slugs(c)).not.toContain('a');
  });

  it('bấm liên tiếp vào CÙNG một món trong lúc đang thêm: nút khoá, chỉ một lệnh', async () => {
    let done!: (v: unknown) => void;
    state.add = () => new Promise((r) => (done = r));
    const c = await mount();
    const btn = qa(c, 'freeship-add')[0]!;
    click(btn);
    await flush(2);
    expect(qa(c, 'freeship-add')[0]!.getAttribute('aria-disabled')).toBe('true');
    expect(qa(c, 'freeship-add')[0]!.getAttribute('aria-busy')).toBe('true');
    click(qa(c, 'freeship-add')[0]!);
    await flush(2);
    expect(state.addCalls).toHaveLength(1);
    await act(async () => done(cartOf([line(), line({ id: 'i2', slug: 'c', variationId: 'v-c', total: 60000, unitPrice: 60000 })])));
    await flush(4);
    expect(state.addCalls).toHaveLength(1);
  });

  it('bấm hai lần vào cùng một món trong cùng một act: chỉ một lệnh (khoá đồng bộ)', async () => {
    state.add = () => new Promise(() => undefined);
    const c = await mount();
    const btn = qa(c, 'freeship-add')[0]!;
    act(() => {
      btn.click();
      btn.click();
    });
    await flush(2);
    expect(state.addCalls).toEqual([['v-c', 1]]);
  });

  it('món khác vẫn thêm được trong lúc một món đang bay (khoá theo món, như Mini App), món đang bay vẫn bị khoá', async () => {
    state.add = () => new Promise(() => undefined);
    const c = await mount();
    click(qa(c, 'freeship-add')[0]!);
    await flush(2);
    click(qa(c, 'freeship-add')[1]!);
    await flush(2);
    expect(state.addCalls).toEqual([['v-c', 1], ['v-a', 1]]);
    // Lệnh sau cùng là món "a": khoá theo lệnh sau cùng sẽ mở nhầm món "c" đang bay.
    click(qa(c, 'freeship-add')[0]!);
    await flush(2);
    expect(state.addCalls).toHaveLength(2);
  });

  it('hai lệnh chồng nhau mà phản hồi về lệch thứ tự: giỏ được tải lại từ máy chủ, không để phản hồi cũ ghi đè', async () => {
    const calls: ((v: unknown) => void)[] = [];
    state.add = () => new Promise((r) => calls.push(r));
    const lineC = line({ id: 'i2', slug: 'c', variationId: 'v-c', productName: 'Món c', unitPrice: 60000, total: 60000 });
    const lineA = line({ id: 'i3', slug: 'a', variationId: 'v-a', productName: 'Món a', unitPrice: 30000, total: 30000 });
    const c = await mount();
    click(qa(c, 'freeship-add')[0]!);
    await flush(2);
    click(qa(c, 'freeship-add')[1]!);
    await flush(2);
    expect(calls).toHaveLength(2);
    state.cart = cartOf([line(), lineC, lineA]);
    // Phản hồi của lệnh sau (đủ cả hai món) về trước, phản hồi lệnh đầu (chưa có món sau) về sau.
    await act(async () => calls[1]!(cartOf([line(), lineC, lineA])));
    await act(async () => calls[0]!(cartOf([line(), lineC])));
    await flush(6);
    expect(qa(c, 'cart-line')).toHaveLength(3);
  });

  it('lệnh đi một mình sau khi cặp chồng nhau đã xong: ghi thẳng phản hồi của máy chủ, không tải lại thêm', async () => {
    const calls: ((v: unknown) => void)[] = [];
    state.add = () => new Promise((r) => calls.push(r));
    const c = await mount();
    click(qa(c, 'freeship-add')[0]!);
    await flush(2);
    click(qa(c, 'freeship-add')[1]!);
    await flush(2);
    await act(async () => calls[1]!(state.cart));
    await act(async () => calls[0]!(state.cart));
    await flush(6);
    // `getCart` vẫn trả giỏ 1 dòng: thấy 2 dòng nghĩa là giỏ lấy từ phản hồi chứ không phải tải lại.
    state.add = async () => cartOf([line(), line({ id: 'i9', slug: 'f', variationId: 'v-f', productName: 'Món f', unitPrice: 5000, total: 5000 })]);
    click(qa(c, 'freeship-add')[0]!);
    await flush(6);
    expect(qa(c, 'cart-line')).toHaveLength(2);
  });

  describe('giỏ đang tải lại sau lệnh chồng nhau (lần tải lại bị giữ)', () => {
    const lineC = () => line({ id: 'i2', slug: 'c', variationId: 'v-c', productName: 'Món c', unitPrice: 60000, total: 60000 });
    const lineA = () => line({ id: 'i3', slug: 'a', variationId: 'v-a', productName: 'Món a', unitPrice: 30000, total: 30000 });
    const overlapAndHoldReload = async () => {
      const calls: ((v: unknown) => void)[] = [];
      state.add = () => new Promise((r) => calls.push(r));
      const c = await mount();
      click(qa(c, 'freeship-add')[0]!);
      await flush(2);
      click(qa(c, 'freeship-add')[1]!);
      await flush(2);
      const after = cartOf([line(), lineC(), lineA()]);
      state.cart = after;
      let open!: () => void;
      state.gate = new Promise((r) => {
        open = () => r(undefined);
      });
      return { c, calls, after, open };
    };
    const addBtn = (c: ParentNode, slug: string) => qa(c, 'freeship-addon').find((e) => e.dataset.slug === slug)!.querySelector<HTMLElement>('[data-testid="freeship-add"]')!;

    it('món hoàn tất SAU CÙNG: chạm lại món đó khi giỏ mới chưa về không thêm lần hai; giỏ về thì món rời dải', async () => {
      const { c, calls, after, open } = await overlapAndHoldReload();
      await act(async () => calls[0]!(after));
      await act(async () => calls[1]!(after));
      await flush(4);
      expect(slugs(c)).toContain('c');
      click(addBtn(c, 'c'));
      await flush(4);
      expect(state.addCalls).toEqual([['v-c', 1], ['v-a', 1]]);
      await act(async () => open());
      await flush(6);
      expect(slugs(c)).not.toContain('c');
      expect(qa(c, 'cart-line')).toHaveLength(3);
    });

    it('món hoàn tất TRƯỚC (lần tải lại của nó bị lần sau huỷ): chạm lại cũng không thêm lần hai', async () => {
      const { c, calls, after, open } = await overlapAndHoldReload();
      await act(async () => calls[1]!(after));
      await act(async () => calls[0]!(after));
      await flush(4);
      click(addBtn(c, 'a'));
      await flush(4);
      expect(state.addCalls).toEqual([['v-c', 1], ['v-a', 1]]);
      await act(async () => open());
      await flush(6);
      expect(slugs(c)).not.toContain('a');
    });

    it('hai món cùng bay: CẢ HAI nút báo aria-busy (không chỉ lệnh sau cùng), khoá nuốt cú chạm nên nút phải nói đang bận', async () => {
      state.add = () => new Promise(() => undefined);
      const c = await mount();
      click(addBtn(c, 'c'));
      await flush(2);
      click(addBtn(c, 'a'));
      await flush(2);
      expect(addBtn(c, 'c').getAttribute('aria-busy')).toBe('true');
      expect(addBtn(c, 'a').getAttribute('aria-busy')).toBe('true');
      expect(qa(c, 'freeship-addon')).toHaveLength(2);
      expect(q(c, 'freeship-addons')!.getAttribute('aria-busy')).toBe('true');
    });
  });

  it('lỗi của món bay trước vẫn hiện dù lệnh sau cùng (món khác) thành công: lỗi không phụ thuộc lệnh sau cùng', async () => {
    const calls: { ok: (v: unknown) => void; fail: (e: unknown) => void }[] = [];
    state.add = () => new Promise((ok, fail) => calls.push({ ok, fail }));
    const c = await mount();
    click(qa(c, 'freeship-add')[0]!);
    await flush(2);
    click(qa(c, 'freeship-add')[1]!);
    await flush(2);
    await act(async () => calls[1]!.ok(state.cart));
    await act(async () => calls[0]!.fail(new Error('Món c vừa hết hàng')));
    await flush(4);
    expect(c.querySelector('[data-testid="cart-freeship"] [role="alert"]')?.textContent).toContain('Món c vừa hết hàng');
  });

  it('lỗi thì nhả khoá: bấm lại đúng món đó gửi lệnh thứ hai, lời báo cũ mất', async () => {
    state.add = async () => {
      throw new Error('Không thêm được');
    };
    const c = await mount();
    click(qa(c, 'freeship-add')[0]!);
    await flush(6);
    expect(c.querySelector('[data-testid="cart-freeship"] [role="alert"]')).not.toBeNull();
    state.add = () => new Promise(() => undefined);
    click(qa(c, 'freeship-add')[0]!);
    await flush(2);
    expect(state.addCalls).toHaveLength(2);
    expect(c.querySelector('[data-testid="cart-freeship"] [role="alert"]')).toBeNull();
  });

  it('đạt ngưỡng sau khi thêm: thanh chuyển sang chúc mừng (không còn thanh), dải thu lại', async () => {
    state.add = async () => cartOf([line(), line({ id: 'i2', slug: 'c', variationId: 'v-c', productName: 'Món c', unitPrice: 60000, total: 60000 })]);
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
    expect(q(c, 'freeship-fill')!.style.width).toBe('85%');
    expect((qa(c, 'freeship-add')[0] as HTMLButtonElement).disabled).toBe(false);
    expect(qa(c, 'freeship-add')[0]!.hasAttribute('aria-busy')).toBe(false);
    expect(qa(c, 'freeship-add')[0]!.hasAttribute('aria-disabled')).toBe(false);
  });

  it('đã đủ ngưỡng từ đầu: chỉ có dòng chúc mừng, không gợi ý, không gọi thêm giỏ', async () => {
    state.cart = cartOf([line({ unitPrice: 600000, total: 600000 })]);
    const c = await mount();
    expect(q(c, 'freeship-progress')!.dataset.reached).toBe('true');
    expect(q(c, 'freeship-addons')).toBeNull();
    expect(state.addCalls).toHaveLength(0);
  });

  it('W51B chưa đạt ngưỡng: nút "Mua thêm" nằm trong thanh, tên truy cập nêu số còn thiếu, bấm đưa về Trang chủ', async () => {
    const c = await mount();
    const cta = q(c, 'freeship-shop-more-cta')!;
    expect(q(c, 'freeship-progress')!.contains(cta)).toBe(true);
    expect(cta.textContent).toBe('Mua thêm');
    expect(cta.getAttribute('aria-label')).toBe('Mua thêm: còn thiếu 51.000đ để được Miễn phí giao hàng');
    expect(state.push).not.toHaveBeenCalled();
    click(cta);
    expect(state.push).toHaveBeenCalledTimes(1);
    expect(state.push).toHaveBeenCalledWith('/');
  });

  it('W51B đã đủ ngưỡng (từ đầu hoặc sau khi thêm món): không còn nút "Mua thêm", khối vẫn là một thanh', async () => {
    state.cart = cartOf([line({ unitPrice: 600000, total: 600000 })]);
    const c = await mount();
    expect(q(c, 'freeship-progress')!.dataset.reached).toBe('true');
    expect(q(c, 'freeship-shop-more-cta')).toBeNull();
    expect(qa(c, 'freeship-progress')).toHaveLength(1);
  });

  it('W51B thêm món bù đơn tới khi đạt ngưỡng: nút "Mua thêm" biến mất cùng thanh', async () => {
    state.add = async () => cartOf([line(), line({ id: 'i2', slug: 'c', variationId: 'v-c', productName: 'Món c', unitPrice: 60000, total: 60000 })]);
    const c = await mount();
    expect(q(c, 'freeship-shop-more-cta')).not.toBeNull();
    click(qa(c, 'freeship-add')[0]!);
    await flush(6);
    expect(q(c, 'freeship-progress')!.dataset.reached).toBe('true');
    expect(q(c, 'freeship-shop-more-cta')).toBeNull();
  });

  it('bỏ chọn hết: thanh tính theo phần đang chọn (thiếu đủ ngưỡng, thanh 0%)', async () => {
    const c = await mount();
    click(c.querySelector('input[aria-label="Chọn tất cả sản phẩm"]'));
    await flush(3);
    expect(q(c, 'freeship-progress')!.textContent).toContain('Mua thêm 340.000đ');
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
    expect(q(c, 'freeship-progress')!.textContent).toContain('Mua thêm 51.000đ để được Miễn phí giao hàng cho phần hàng Tubu Tree giao');
  });

  it('gợi ý bỏ qua món do gian hàng tự giao hoặc tạm nghỉ', async () => {
    state.best = best([
      card('a', 30000, { fulfiller: { kind: 'MERCHANT', name: 'Linh', shippingFee: null, freeShipFrom: null } }),
      card('b', 10000),
      card('c', 60000),
      card('f', 5000),
    ]);
    const c = await mount();
    expect(slugs(c)).toEqual(['c', 'b']);
  });
});

describe('/gio-hang — thêm món bù đơn bị từ chối: tải lại rồi mới nhả khoá', () => {
  const holdCart = () => {
    let open!: () => void;
    state.gate = new Promise((r) => {
      open = () => r(undefined);
    });
    return { open: () => open() };
  };
  const addOf = (c: ParentNode, slug: string) => qa(c, 'freeship-addon').find((e) => e.dataset.slug === slug)!.querySelector<HTMLElement>('[data-testid="freeship-add"]')!;
  const alertText = (c: ParentNode) => c.querySelector('[data-testid="cart-freeship"] [role="alert"]')?.textContent ?? '';

  it.each([400, 404, 409, 422])('%i: lời lỗi hiện ngay, giỏ và kệ Bán chạy được tải lại, nút giữ bận tới khi giỏ về; chạm lần hai không gửi', async (status) => {
    state.add = async () => {
      throw new ApiError('Món c vừa hết hàng.', status);
    };
    const c = await mount();
    const carts = state.cartGets;
    const bests = state.bestGets;
    const gate = holdCart();
    click(addOf(c, 'c'));
    await flush(6);
    expect(alertText(c)).toBe('Món c vừa hết hàng.');
    expect(state.cartGets).toBe(carts + 1);
    expect(state.bestGets).toBe(bests + 1);
    expect(addOf(c, 'c').getAttribute('aria-busy')).toBe('true');
    expect((addOf(c, 'c') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      addOf(c, 'c').click();
      addOf(c, 'c').click();
    });
    expect(state.addCalls).toEqual([['v-c', 1]]);
    gate.open();
    await flush(8);
    expect(addOf(c, 'c').hasAttribute('aria-busy')).toBe(false);
  });

  it('bị từ chối vì món hết hàng: kệ Bán chạy tải lại nên món đó rời dải', async () => {
    state.add = async () => {
      throw new ApiError('Món c vừa hết hàng.', 400);
    };
    const c = await mount();
    expect(slugs(c)).toContain('c');
    state.best = best([card('a', 30000), card('b', 10000), card('c', 60000, { inStock: false }), card('d', 100000), card('e', 20000)]);
    click(addOf(c, 'c'));
    await flush(8);
    expect(slugs(c)).not.toContain('c');
  });

  it('kệ Bán chạy tải lại treo: nút vẫn giữ bận (khoá chờ cả giỏ lẫn kệ)', async () => {
    state.add = async () => {
      throw new ApiError('Món c vừa hết hàng.', 409);
    };
    const c = await mount();
    let open!: () => void;
    state.bestGate = new Promise((r) => {
      open = () => r(undefined);
    });
    click(addOf(c, 'c'));
    await flush(8);
    expect(addOf(c, 'c').getAttribute('aria-busy')).toBe('true');
    open();
    await flush(8);
    expect(addOf(c, 'c').hasAttribute('aria-busy')).toBe(false);
  });

  it.each([401, 403, 500, 503])('%i: không tải lại, nhả nút ngay', async (status) => {
    state.add = async () => {
      throw new ApiError('Máy chủ bận.', status);
    };
    const c = await mount();
    const carts = state.cartGets;
    const bests = state.bestGets;
    click(addOf(c, 'c'));
    await flush(6);
    expect(state.cartGets).toBe(carts);
    expect(state.bestGets).toBe(bests);
    expect(addOf(c, 'c').hasAttribute('aria-busy')).toBe(false);
    expect(alertText(c)).not.toBe('');
  });

  it('mất mạng: không tải lại, nhả ngay', async () => {
    state.add = async () => {
      throw new NetworkError(false);
    };
    const c = await mount();
    const carts = state.cartGets;
    click(addOf(c, 'c'));
    await flush(6);
    expect(state.cartGets).toBe(carts);
    expect(addOf(c, 'c').hasAttribute('aria-busy')).toBe(false);
  });

  it('giỏ tải lại treo quá 4 giây thì nhả nút', async () => {
    state.add = async () => {
      throw new ApiError('Món c vừa hết hàng.', 409);
    };
    const c = await mount();
    holdCart();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      click(addOf(c, 'c'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_900);
      });
      expect(addOf(c, 'c').getAttribute('aria-busy')).toBe('true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(addOf(c, 'c').hasAttribute('aria-busy')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hai lệnh chồng nhau thành công mà giỏ tải lại treo quá 4 giây: nhả khoá, không giữ mãi', async () => {
    const calls: ((v: unknown) => void)[] = [];
    state.add = () => new Promise((r) => calls.push(r));
    const c = await mount();
    click(addOf(c, 'c'));
    await flush(2);
    click(addOf(c, 'a'));
    await flush(2);
    holdCart();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => calls[0]!(state.cart));
      await act(async () => calls[1]!(state.cart));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_900);
      });
      expect(addOf(c, 'c').getAttribute('aria-busy')).toBe('true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(addOf(c, 'c').hasAttribute('aria-busy')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('/gio-hang — món bù freeship bị từ chối rồi rời dải: lời lỗi vẫn đọc được, không hiện lại như bóng ma', () => {
  const mountWithClient = async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    mounted = render(<CartPage />, client);
    await flush(8);
    return { c: mounted.container, client };
  };
  const addOf = (c: ParentNode, slug: string) => qa(c, 'freeship-addon').find((e) => e.dataset.slug === slug)!.querySelector<HTMLElement>('[data-testid="freeship-add"]')!;
  const alerts = () => Array.from(document.querySelectorAll('[role="alert"]')).map((e) => e.textContent ?? '');
  // Kệ tải lại sau khi c hết hàng chỉ còn a đủ điều kiện (b cũng vừa hết): dải rơi dưới mức tối thiểu 2 món và biến mất.
  const soldOutC = best([card('a', 30000), card('b', 10000, { inStock: false }), card('c', 60000, { inStock: false }), card('d', 100000)]);

  it('món duy nhất đủ điều kiện bị từ chối vì hết hàng, kệ tải lại làm dải biến mất: lời lỗi vẫn hiện một mình', async () => {
    state.add = async () => {
      throw new ApiError('Món c vừa hết hàng.', 409);
    };
    const { c } = await mountWithClient();
    expect(slugs(c)).toEqual(['c', 'a']);
    state.best = soldOutC;
    click(addOf(c, 'c'));
    await flush(10);
    expect(slugs(c)).toEqual([]);
    expect(q(c, 'freeship-addons')).toBeNull();
    expect(alerts()).toContain('Món c vừa hết hàng.');
  });

  it('dải hiện lại sau khi biến mất: lời lỗi của lần trước không hiện lại', async () => {
    state.add = async () => {
      throw new ApiError('Món c vừa hết hàng.', 409);
    };
    const { c, client } = await mountWithClient();
    state.best = soldOutC;
    click(addOf(c, 'c'));
    await flush(10);
    expect(alerts()).toContain('Món c vừa hết hàng.');
    state.best = BEST;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['products', 'home-best-seller'] });
    });
    await flush(8);
    expect(slugs(c)).toEqual(['c', 'a']);
    expect(alerts()).not.toContain('Món c vừa hết hàng.');
  });

  it('dải vẫn còn sau khi bị từ chối: lời lỗi hiện cạnh dải như cũ', async () => {
    state.add = async () => {
      throw new ApiError('Máy chủ bận.', 503);
    };
    const { c } = await mountWithClient();
    click(addOf(c, 'c'));
    await flush(8);
    expect(slugs(c)).toEqual(['c', 'a']);
    expect(alerts().join(' ')).toContain('Máy chủ đang bận');
  });
});

describe('/gio-hang — món bù freeship tải lại giỏ khi lệnh đổi số lượng dòng còn bay', () => {
  const addOf = (c: ParentNode, slug: string) => qa(c, 'freeship-addon').find((e) => e.dataset.slug === slug)!.querySelector<HTMLElement>('[data-testid="freeship-add"]')!;
  const plus = (c: ParentNode) => c.querySelector<HTMLElement>('[aria-label="Tăng số lượng Serum dưỡng ẩm"]')!;
  const qtyText = (c: ParentNode) => c.querySelector('[data-testid="cart-line"] [aria-live="polite"]')!.textContent;
  const heldLineOp = () => {
    let done!: (cart: unknown) => void;
    state.update = () => new Promise((resolve) => (done = resolve));
    return { finish: (cart: unknown) => done(cart) };
  };

  it('món bù bị từ chối khi lệnh đổi số lượng đang bay: chưa tải giỏ (kẻo giỏ cũ về sau ghi đè số lượng mới), nút giữ bận, lệnh xong thì tải một lần và số lượng mới còn nguyên', async () => {
    const c = await mount();
    const op = heldLineOp();
    click(plus(c));
    await flush(4);
    state.add = async () => {
      throw new ApiError('Món c vừa hết hàng.', 409);
    };
    const carts = state.cartGets;
    click(addOf(c, 'c'));
    await flush(8);
    expect(state.cartGets).toBe(carts);
    expect(addOf(c, 'c').getAttribute('aria-busy')).toBe('true');
    const after = cartOf([line({ quantity: 2, total: 292000 })]);
    state.cart = after;
    await act(async () => op.finish(after));
    await flush(10);
    expect(state.cartGets).toBe(carts + 1);
    expect(addOf(c, 'c').hasAttribute('aria-busy')).toBe(false);
    expect(qtyText(c)).toBe('2');
  });

  it('hai món bù chồng nhau thành công khi lệnh đổi số lượng đang bay: giỏ chỉ tải sau khi lệnh dòng xong', async () => {
    const calls: ((v: unknown) => void)[] = [];
    state.add = () => new Promise((r) => calls.push(r));
    const c = await mount();
    click(addOf(c, 'c'));
    await flush(2);
    click(addOf(c, 'a'));
    await flush(2);
    const op = heldLineOp();
    click(plus(c));
    await flush(4);
    const carts = state.cartGets;
    await act(async () => calls[0]!(state.cart));
    await act(async () => calls[1]!(state.cart));
    await flush(8);
    expect(state.cartGets).toBe(carts);
    const after = cartOf([line({ quantity: 2, total: 292000 })]);
    state.cart = after;
    await act(async () => op.finish(after));
    await flush(10);
    expect(state.cartGets).toBeGreaterThan(carts);
    expect(qtyText(c)).toBe('2');
  });

  it('không có lệnh dòng nào đang bay: món bù bị từ chối tải giỏ ngay', async () => {
    state.add = async () => {
      throw new ApiError('Món c vừa hết hàng.', 409);
    };
    const c = await mount();
    const carts = state.cartGets;
    click(addOf(c, 'c'));
    await flush(8);
    expect(state.cartGets).toBe(carts + 1);
  });

  it('lệnh dòng treo quá 4 giây: món bù bị từ chối vẫn nhả nút', async () => {
    const c = await mount();
    heldLineOp();
    click(plus(c));
    await flush(4);
    state.add = async () => {
      throw new ApiError('Món c vừa hết hàng.', 409);
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      click(addOf(c, 'c'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_900);
      });
      expect(addOf(c, 'c').getAttribute('aria-busy')).toBe('true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(addOf(c, 'c').hasAttribute('aria-busy')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});


describe('/gio-hang — dải "Thêm 1 món nhỏ để đủ Miễn phí giao hàng" (tubu-w3-02, cờ commerce.freeship_booster_enabled)', () => {
  const on = { freeshipThreshold: 340000, freeshipBoosterEnabled: true };
  // Còn thiếu 51.000 (giỏ 289.000, mốc 340.000): cửa sổ mới tới 96.000.
  const UPSELL = [card('hot', 90000), card('close', 55000), card('over', 96001), card('cheap', 30000), card('serum', 40000)];

  it('cờ bật: hỏi /upsell/freeship đúng số còn thiếu và slug trong giỏ, không hỏi kệ Bán chạy; giữ thứ tự máy chủ, cửa sổ 45.000', async () => {
    state.config = on;
    state.upsell = UPSELL;
    const c = await mount();
    expect(state.upsellCalls).toEqual([{ gap: 51000, exclude: 'serum' }]);
    expect(state.bestGets).toBe(0);
    expect(q(c, 'freeship-addons')!.getAttribute('aria-label')).toBe('Gợi ý mua thêm cho đủ Miễn phí giao hàng');
    // "hot" (90.000) đứng trước "close" (55.000) vì máy chủ xếp bán chạy trước; 96.001 vượt cửa sổ; "serum" đã trong giỏ.
    expect(slugs(c)).toEqual(['hot', 'close']);
  });

  it('cờ tắt (cấu hình đọc được): món từ kệ Bán chạy, cùng dòng số còn thiếu, không hỏi /upsell/freeship', async () => {
    state.config = { freeshipThreshold: 340000, freeshipBoosterEnabled: false };
    const c = await mount();
    expect(state.upsellCalls).toEqual([]);
    expect(q(c, 'freeship-addons')!.getAttribute('aria-label')).toBe('Gợi ý mua thêm cho đủ Miễn phí giao hàng');
    expect(slugs(c)).toEqual(['c', 'a']);
  });

  it('/upsell/freeship lỗi (cờ vừa tắt, cấu hình còn trong bộ nhớ đệm nên máy chủ trả 404): lùi về dải cũ từ kệ Bán chạy, giỏ vẫn dùng được', async () => {
    state.config = on;
    state.upsellError = true;
    const c = await mount();
    expect(state.upsellCalls).toHaveLength(1);
    expect(q(c, 'freeship-addons')!.getAttribute('aria-label')).toBe('Gợi ý mua thêm cho đủ Miễn phí giao hàng');
    expect(slugs(c)).toEqual(['c', 'a']);
    expect(q(c, 'freeship-progress')!.textContent).toContain('Mua thêm 51.000đ');
    expect(q(c, 'sticky-bar')!.querySelector('a[href="/thanh-toan"]')).not.toBeNull();
  });

  it('một chạm "+ Thêm" đủ mốc: thanh chuyển sang câu chúc mừng và dải đầu giỏ chạy hiệu ứng mừng một lần; dải gợi ý biến mất', async () => {
    state.config = on;
    state.upsell = UPSELL;
    state.add = async () => cartOf([line(), line({ id: 'i2', slug: 'hot', variationId: 'v-hot', productName: 'Món hot', unitPrice: 90000, total: 90000 })]);
    const c = await mount();
    expect(q(c, 'cart-freeship')!.hasAttribute('data-celebrate')).toBe(false);
    click(qa(c, 'freeship-add')[0]!);
    await flush(6);
    expect(state.addCalls).toEqual([['v-hot', 1]]);
    expect(q(c, 'freeship-progress')!.dataset.reached).toBe('true');
    expect(q(c, 'cart-freeship')!.getAttribute('data-celebrate')).toBe('true');
    expect(q(c, 'freeship-addons')).toBeNull();
  });

  it('giỏ mở ra đã đủ mốc: không chạy hiệu ứng mừng (không có gì vừa mở khoá)', async () => {
    state.config = on;
    state.cart = cartOf([line({ total: 600000, unitPrice: 600000 })]);
    const c = await mount();
    expect(q(c, 'freeship-progress')!.dataset.reached).toBe('true');
    expect(q(c, 'cart-freeship')!.hasAttribute('data-celebrate')).toBe(false);
    expect(state.upsellCalls).toEqual([]);
  });
});

describe('/gio-hang — dải mua thêm nhắm quà dùng thử 0đ sau khi đã Miễn phí giao hàng (tubu-w7-02)', () => {
  const on = { freeshipThreshold: 199000, freeshipBoosterEnabled: true };
  const option = (unlocked: boolean) => ({ variationId: 'v-fuwa', productName: 'Fuwa3e', variationName: '100ml', slug: 'fuwa', thumbnail: null, minOrder: 340000, unlocked });
  const gift = (base: number) => ({
    base,
    minOrder: 340000,
    nextMinOrder: base >= 340000 ? null : 340000,
    shortfall: Math.max(0, 340000 - base),
    options: [option(base >= 340000)],
    selectedVariationId: base >= 340000 ? 'v-fuwa' : null,
    declined: false,
  });
  // Giỏ 289.000 đã qua mốc giao hàng 199.000, còn thiếu 51.000 tới quà 340.000 (mốc đọc từ khối quà của máy chủ). "fuwa" là chính món quà nên không được gợi ý.
  const UPSELL = [card('hot', 90000), card('close', 55000), card('fuwa', 52000), card('cheap', 30000)];
  const giftCart = (items: unknown[]) => {
    const subtotal = (items as { total: number }[]).reduce((s, it) => s + it.total, 0);
    return cartOf(items, { freeship: true, freeshipThreshold: 199000, giftTrial: gift(subtotal) });
  };

  it('dòng đầu nói số còn thiếu tới quà, hỏi /upsell/freeship với số thiếu tới quà, bỏ món quà; ô quà khoá không nói lại số đó', async () => {
    state.config = on;
    state.upsell = UPSELL;
    state.cart = giftCart([line()]);
    const c = await mount();
    // Món quà cũng đi vào `exclude`: máy chủ không tốn chỗ trong danh sách cho món dải sẽ bỏ.
    expect(state.upsellCalls).toEqual([{ gap: 51000, exclude: 'fuwa,serum' }]);
    const rail = q(c, 'freeship-addons')!;
    expect(rail.getAttribute('data-stage')).toBe('gift');
    expect(rail.getAttribute('aria-label')).toBe('Thêm 51.000đ nữa để nhận quà dùng thử 0đ');
    expect(slugs(c)).toEqual(['hot', 'close']);
    expect(q(c, 'gift-trial-row')).toBeNull();
  });

  it('mốc quà mà dải không đủ 2 món: không có dải, ô quà khoá nói số còn thiếu như cũ', async () => {
    state.config = on;
    state.upsell = [card('hot', 90000), card('fuwa', 52000)];
    state.cart = giftCart([line()]);
    const c = await mount();
    expect(q(c, 'freeship-addons')).toBeNull();
    expect(q(c, 'gift-trial-row')!.getAttribute('data-state')).toBe('locked');
    expect(q(c, 'gift-trial-row')!.textContent).toContain('Thêm 51.000đ để nhận quà dùng thử 0đ');
  });

  it('một chạm "+ Thêm" vượt mốc quà: dải rời đi và ô quà mở ngay theo giỏ máy chủ trả, không tải lại trang', async () => {
    state.config = on;
    state.upsell = UPSELL;
    state.cart = giftCart([line()]);
    const added = giftCart([line(), line({ id: 'i2', slug: 'close', variationId: 'v-close', productName: 'Món close', unitPrice: 55000, total: 55000 })]);
    state.add = async () => added;
    const c = await mount();
    const gets = state.cartGets;
    click(qa(c, 'freeship-addon').find((e) => e.dataset.slug === 'close')!.querySelector<HTMLElement>('[data-testid="freeship-add"]')!);
    await flush(8);
    expect(state.addCalls).toEqual([['v-close', 1]]);
    expect(q(c, 'freeship-addons')).toBeNull();
    expect(q(c, 'gift-trial-row')!.getAttribute('data-state')).toBe('chosen');
    expect(q(c, 'gift-trial-row')!.textContent).toContain('Fuwa3e');
    expect(state.cartGets).toBe(gets);
  });

  it('khách đã chọn không nhận quà, hay giỏ không có khối quà: đã Miễn phí giao hàng thì không còn dải', async () => {
    state.config = on;
    state.upsell = UPSELL;
    state.cart = cartOf([line()], { freeship: true, freeshipThreshold: 199000, giftTrial: { ...gift(289000), declined: true } });
    let c = await mount();
    expect(q(c, 'freeship-addons')).toBeNull();
    mounted?.unmount();
    state.cart = cartOf([line()], { freeship: true, freeshipThreshold: 199000 });
    c = await mount();
    expect(q(c, 'freeship-addons')).toBeNull();
    expect(state.upsellCalls).toEqual([]);
  });
});
