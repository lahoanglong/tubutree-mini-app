// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  addCalls: [] as [string, number][],
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push, replace: vi.fn() }), usePathname: () => '/gio-hang' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
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
  state.cartGets = 0;
  state.bestGets = 0;
  state.bestGate = null;
  state.gate = null;
  state.addCalls = [];
  state.push.mockClear();
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
    await act(async () => done(cartOf([line(), line({ id: 'i2', slug: 'c', variationId: 'v-c', total: 230000, unitPrice: 230000 })])));
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
    const lineC = line({ id: 'i2', slug: 'c', variationId: 'v-c', productName: 'Món c', unitPrice: 230000, total: 230000 });
    const lineA = line({ id: 'i3', slug: 'a', variationId: 'v-a', productName: 'Món a', unitPrice: 50000, total: 50000 });
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
    state.add = async () => cartOf([line(), line({ id: 'i9', slug: 'f', variationId: 'v-f', productName: 'Món f', unitPrice: 90000, total: 90000 })]);
    click(qa(c, 'freeship-add')[0]!);
    await flush(6);
    expect(qa(c, 'cart-line')).toHaveLength(2);
  });

  describe('giỏ đang tải lại sau lệnh chồng nhau (lần tải lại bị giữ)', () => {
    const lineC = () => line({ id: 'i2', slug: 'c', variationId: 'v-c', productName: 'Món c', unitPrice: 230000, total: 230000 });
    const lineA = () => line({ id: 'i3', slug: 'a', variationId: 'v-a', productName: 'Món a', unitPrice: 50000, total: 50000 });
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
      expect(addBtn(c, 'b').getAttribute('aria-busy')).toBeNull();
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
    expect(cta.getAttribute('aria-label')).toBe('Mua thêm: còn thiếu 211.000đ để được Miễn phí giao hàng');
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
    state.add = async () => cartOf([line(), line({ id: 'i2', slug: 'c', variationId: 'v-c', productName: 'Món c', unitPrice: 230000, total: 230000 })]);
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
    state.best = best([card('a', 50000), card('b', 120000), card('c', 230000, { inStock: false }), card('d', 300000), card('e', 100000)]);
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
