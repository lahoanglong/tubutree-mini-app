// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// W72B: khoá chống đua của dòng giỏ (tăng/giảm số lượng, xoá, Hoàn tác). Khoá phải đồng bộ (ref) và theo TỪNG dòng:
// state chỉ đúng sau lần vẽ kế, và `mutation.variables` chỉ nhớ lệnh sau cùng nên đã mở khoá nhầm dòng đang bay.

interface Deferred {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}
const defer = (): Deferred & { promise: Promise<unknown> } => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const state = vi.hoisted(() => ({
  cart: null as unknown,
  gate: null as null | Promise<unknown>,
  cartError: null as Error | null,
  cartCalls: 0,
  updates: [] as { id: string; q: number }[],
  removed: [] as string[],
  added: [] as { variationId: string; quantity: number }[],
  update: null as null | ((id: string, q: number) => Promise<unknown>),
  remove: null as null | ((id: string) => Promise<unknown>),
  add: null as null | ((variationId: string, quantity: number) => Promise<unknown>),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/gio-hang' }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => {
    state.cartCalls += 1;
    if (state.gate) await state.gate;
    if (state.cartError) throw state.cartError;
    return state.cart;
  },
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  getCartSelection: async () => {
    throw new Error('chưa mock');
  },
  applyCoupon: async () => state.cart,
  removeCoupon: async () => state.cart,
  updateCartItem: (id: string, q: number) => {
    state.updates.push({ id, q });
    return state.update!(id, q);
  },
  removeCartItem: (id: string) => {
    state.removed.push(id);
    return state.remove!(id);
  },
  addToCart: (variationId: string, quantity: number) => {
    state.added.push({ variationId, quantity });
    return state.add!(variationId, quantity);
  },
}));

import CartPage from './page';

const line = (over: Record<string, unknown>) => ({
  id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết', variationName: '500ml', slug: 'dau-goi', thumbnail: null,
  unitPrice: 150000, quantity: 2, stock: 5, total: 300000, ...over,
});
const LINE_B = { id: 'i2', variationId: 'v2', productName: 'Xà bông cỏ', slug: 'xa-bong' };
const cartOf = (items: unknown[], over: Record<string, unknown> = {}) => ({
  items, couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 2, ...over,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CartPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const btn = (c: HTMLElement, label: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const plusA = (c: HTMLElement) => btn(c, 'Tăng số lượng Dầu gội bồ kết');
const minusA = (c: HTMLElement) => btn(c, 'Giảm số lượng Dầu gội bồ kết');
const trashA = (c: HTMLElement) => btn(c, 'Xoá Dầu gội bồ kết khỏi giỏ hàng');
const plusB = (c: HTMLElement) => btn(c, 'Tăng số lượng Xà bông cỏ');
const undoButton = (c: HTMLElement) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Hoàn tác');
// Hai cú bấm trong cùng một `act`: React chưa kịp vẽ lại giữa chúng nên mọi cờ bằng state vẫn còn cũ.
const clickTwice = (a: HTMLElement, b: HTMLElement = a) =>
  act(() => {
    a.click();
    b.click();
  });

let deferred: (Deferred & { promise: Promise<unknown> })[] = [];
const hold = () => {
  const d = defer();
  deferred.push(d);
  return d.promise;
};

beforeEach(() => {
  sessionStorage.clear();
  state.updates = [];
  state.removed = [];
  state.added = [];
  deferred = [];
  state.gate = null;
  state.cartError = null;
  state.cartCalls = 0;
  state.cart = cartOf([line({})]);
  state.update = async () => state.cart;
  state.remove = async () => state.cart;
  state.add = async () => state.cart;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/gio-hang — khoá đồng bộ tăng/giảm số lượng của dòng', () => {
  it('bấm "+" hai lần trong cùng một act: chỉ MỘT lệnh đổi số lượng', async () => {
    state.update = hold;
    const { container } = await mount();
    clickTwice(plusA(container));
    await flush(2);
    expect(state.updates).toEqual([{ id: 'i1', q: 3 }]);
  });

  it('"+" rồi "−" rồi "Xoá" trên cùng một dòng trong cùng một act: chỉ lệnh đầu đi (tăng/giảm/xoá dùng chung một khoá theo dòng)', async () => {
    state.update = hold;
    const { container } = await mount();
    act(() => {
      plusA(container).click();
      minusA(container).click();
      trashA(container).click();
    });
    await flush(2);
    expect(state.updates).toEqual([{ id: 'i1', q: 3 }]);
    expect(state.removed).toEqual([]);
  });

  it('"Xoá" rồi "+" trên cùng một dòng trong cùng một act: chỉ lệnh xoá đi', async () => {
    state.remove = hold;
    const { container } = await mount();
    clickTwice(trashA(container), plusA(container));
    await flush(2);
    expect(state.removed).toEqual(['i1']);
    expect(state.updates).toEqual([]);
  });

  it('dòng khác vẫn bấm được trong lúc dòng này đang bay, nhưng dòng đang bay vẫn bị khoá dù lệnh sau cùng thuộc dòng khác', async () => {
    state.cart = cartOf([line({}), line(LINE_B)]);
    state.update = hold;
    const { container } = await mount();
    click(plusA(container));
    await flush(2);
    click(plusB(container));
    await flush(2);
    expect(state.updates).toEqual([{ id: 'i1', q: 3 }, { id: 'i2', q: 3 }]);
    // `update.variables` giờ là dòng B: khoá theo "lệnh sau cùng" sẽ mở nhầm dòng A đang bay.
    click(plusA(container));
    click(trashA(container));
    await flush(2);
    expect(state.updates).toHaveLength(2);
    expect(state.removed).toEqual([]);
    expect(plusA(container).getAttribute('aria-busy')).toBe('true');
    expect(plusB(container).getAttribute('aria-busy')).toBe('true');
  });

  it('đang bay: "−", "+" và "Xoá" của dòng báo aria-busy + aria-disabled, KHÔNG disabled thật, "+" đang giữ focus vẫn giữ focus; xong thì gỡ hết', async () => {
    state.update = hold;
    const { container } = await mount();
    const plus = plusA(container);
    plus.focus();
    click(plus);
    await flush(2);
    for (const b of [plus, minusA(container), trashA(container)]) {
      expect(b.getAttribute('aria-busy')).toBe('true');
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.disabled).toBe(false);
    }
    expect(document.activeElement).toBe(plus);
    await act(async () => deferred[0]!.resolve(state.cart));
    await flush(4);
    for (const b of [plusA(container), minusA(container), trashA(container)]) {
      expect(b.hasAttribute('aria-busy')).toBe(false);
      expect(b.hasAttribute('aria-disabled')).toBe(false);
    }
    expect(document.activeElement).toBe(plusA(container));
  });

  it('món khoá của combo đang bay lệnh đổi số lượng: bấm "Xoá" không mở hộp báo "sẽ mất giảm" (lệnh xoá sẽ bị khoá nuốt im)', async () => {
    const soap = line({ id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết' });
    const shampoo = line(LINE_B);
    state.cart = cartOf([soap, shampoo], {
      comboDiscount: 15000,
      comboGroups: [{ id: 'collection:c1', kind: 'STOREFRONT', title: 'Bộ giặt sạch', discount: 15000, lineIds: ['i1', 'i2'], keyLineIds: ['i1', 'i2'] }],
    });
    state.update = hold;
    const { container } = await mount();
    click(plusA(container));
    await flush(2);
    click(trashA(container));
    await flush(2);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await act(async () => deferred[0]!.resolve(state.cart));
    await flush(4);
    click(trashA(container));
    await flush(2);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it('xong (thành công) thì nhả khoá: bấm tiếp gửi lệnh thứ hai', async () => {
    const { container } = await mount();
    click(plusA(container));
    await flush(4);
    click(plusA(container));
    await flush(4);
    expect(state.updates).toHaveLength(2);
  });

  it('lỗi thì báo role=alert ngay dưới dòng và nhả khoá: bấm lại gửi lệnh mới, lời báo cũ mất', async () => {
    state.update = async () => {
      throw new Error('Không cập nhật được');
    };
    const { container } = await mount();
    click(plusA(container));
    await flush(4);
    expect(container.querySelector('[data-testid="cart-line"] [role="alert"]')?.textContent).toContain('Không cập nhật được');
    expect(plusA(container).hasAttribute('aria-busy')).toBe(false);
    state.update = hold;
    click(plusA(container));
    await flush(2);
    expect(state.updates).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('hai dòng đổi số lượng chồng nhau mà phản hồi (nguyên giỏ) về lệch thứ tự: giỏ lấy lại từ máy chủ, không để phản hồi cũ làm dòng kia quay về số cũ', async () => {
    state.cart = cartOf([line({}), line(LINE_B)]);
    state.update = hold;
    const { container } = await mount();
    const qtyOf = (i: number) => container.querySelectorAll('[data-testid="cart-line"]')[i]!.querySelector('[aria-live="polite"]')!.textContent;
    click(plusA(container));
    await flush(2);
    click(plusB(container));
    await flush(2);
    const final = cartOf([line({ quantity: 3, total: 450000 }), line({ ...LINE_B, quantity: 3, total: 450000 })]);
    state.cart = final;
    // Phản hồi của dòng B (đã đủ cả hai) về trước; phản hồi cũ của dòng A (B còn 2) về sau.
    await act(async () => deferred[1]!.resolve(final));
    await act(async () => deferred[0]!.resolve(cartOf([line({ quantity: 3, total: 450000 }), line(LINE_B)])));
    await flush(6);
    expect([qtyOf(0), qtyOf(1)]).toEqual(['3', '3']);
  });

  it('lệnh đi một mình sau khi cặp chồng nhau đã xong: ghi thẳng phản hồi của máy chủ, không tải lại thêm', async () => {
    state.cart = cartOf([line({}), line(LINE_B)]);
    state.update = hold;
    const { container } = await mount();
    click(plusA(container));
    await flush(2);
    click(plusB(container));
    await flush(2);
    await act(async () => deferred[1]!.resolve(state.cart));
    await act(async () => deferred[0]!.resolve(state.cart));
    await flush(6);
    // `getCart` vẫn trả giỏ cũ (số lượng 2): thấy 5 nghĩa là số lấy từ phản hồi chứ không phải tải lại.
    state.update = async () => cartOf([line({ quantity: 5, total: 750000 }), line(LINE_B)]);
    click(plusA(container));
    await flush(6);
    expect(container.querySelectorAll('[data-testid="cart-line"]')[0]!.querySelector('[aria-live="polite"]')!.textContent).toBe('5');
  });

  it('lỗi của dòng A vẫn hiện dù lệnh sau cùng (dòng B) thành công: lỗi nhớ theo từng dòng', async () => {
    state.cart = cartOf([line({}), line(LINE_B)]);
    state.update = hold;
    const { container } = await mount();
    click(plusA(container));
    await flush(2);
    click(plusB(container));
    await flush(2);
    await act(async () => deferred[1]!.resolve(state.cart));
    await act(async () => deferred[0]!.reject(new Error('Dầu gội hết suất')));
    await flush(4);
    const alerts = [...container.querySelectorAll('[data-testid="cart-line"]')].map((l) => l.querySelector('[role="alert"]')?.textContent ?? null);
    expect(alerts[0]).toContain('Dầu gội hết suất');
    expect(alerts[1]).toBeNull();
  });

  // Phản hồi chồng nhau thì giỏ hiện đang cũ cho tới khi lần tải lại về: khoá của dòng phải giữ tới lúc đó, không thì "+" gửi số lượng tính từ giỏ cũ.
  describe('giỏ đang tải lại sau lệnh chồng nhau (lần tải lại bị giữ)', () => {
    const overlapAndHoldReload = async () => {
      state.cart = cartOf([line({}), line(LINE_B)]);
      state.update = hold;
      const r = await mount();
      click(plusA(r.container));
      await flush(2);
      click(plusB(r.container));
      await flush(2);
      const final = cartOf([line({ quantity: 3, total: 450000 }), line({ ...LINE_B, quantity: 3, total: 450000 })]);
      state.cart = final;
      const gate = defer();
      state.gate = gate.promise;
      return { ...r, final, gate };
    };
    const qtyOf = (c: HTMLElement, i: number) => c.querySelectorAll('[data-testid="cart-line"]')[i]!.querySelector('[aria-live="polite"]')!.textContent;

    it('dòng hoàn tất SAU CÙNG vẫn khoá và báo aria-busy tới khi giỏ mới về; về rồi "+" gửi số lượng tính từ giỏ mới', async () => {
      const { container, final, gate } = await overlapAndHoldReload();
      await act(async () => deferred[1]!.resolve(final));
      await act(async () => deferred[0]!.resolve(final));
      await flush(4);
      expect(qtyOf(container, 0)).toBe('2');
      click(plusA(container));
      await flush(4);
      expect(state.updates).toEqual([{ id: 'i1', q: 3 }, { id: 'i2', q: 3 }]);
      expect(plusA(container).getAttribute('aria-busy')).toBe('true');
      await act(async () => gate.resolve(undefined));
      await flush(6);
      expect(qtyOf(container, 0)).toBe('3');
      expect(plusA(container).getAttribute('aria-busy')).toBeNull();
      state.update = async () => state.cart;
      click(plusA(container));
      await flush(4);
      expect(state.updates[2]).toEqual({ id: 'i1', q: 4 });
    });

    it('dòng hoàn tất TRƯỚC (lần tải lại của nó bị lần sau huỷ) cũng khoá tới khi giỏ mới về', async () => {
      const { container, final, gate } = await overlapAndHoldReload();
      await act(async () => deferred[0]!.resolve(final));
      await act(async () => deferred[1]!.resolve(final));
      await flush(4);
      click(plusA(container));
      await flush(4);
      expect(state.updates).toEqual([{ id: 'i1', q: 3 }, { id: 'i2', q: 3 }]);
      expect(plusA(container).getAttribute('aria-busy')).toBe('true');
      await act(async () => gate.resolve(undefined));
      await flush(6);
      expect(plusA(container).getAttribute('aria-busy')).toBeNull();
    });

    it('xoá dòng chồng với đổi số lượng dòng khác: tải lại giữ thì bấm "+" ở dòng vừa xoá không gửi lệnh lên một mã đã mất', async () => {
      state.cart = cartOf([line({}), line(LINE_B)]);
      state.update = hold;
      state.remove = hold;
      const { container } = await mount();
      click(plusB(container));
      await flush(2);
      click(trashA(container));
      await flush(2);
      const after = cartOf([line({ ...LINE_B, quantity: 3, total: 450000 })]);
      state.cart = after;
      const gate = defer();
      state.gate = gate.promise;
      await act(async () => deferred[0]!.resolve(after));
      await act(async () => deferred[1]!.resolve(after));
      await flush(4);
      click(plusA(container));
      await flush(4);
      expect(state.updates).toEqual([{ id: 'i2', q: 3 }]);
      await act(async () => gate.resolve(undefined));
      await flush(6);
      expect(container.querySelectorAll('[data-testid="cart-line"]')).toHaveLength(1);
      expect(undoButton(container)).toBeTruthy();
    });
  });
});

describe('/gio-hang — khoá đồng bộ xoá dòng và Hoàn tác', () => {
  it('bấm "Xoá" hai lần trong cùng một act: chỉ MỘT lệnh xoá, thanh hoàn tác vẫn hiện', async () => {
    const { container } = await mount();
    clickTwice(trashA(container));
    await flush(4);
    expect(state.removed).toEqual(['i1']);
    expect(undoButton(container)).toBeDefined();
  });

  it('dòng "ngừng bán": bấm "Xoá" hai lần trong cùng một act chỉ gửi một lệnh, nút báo aria-busy', async () => {
    state.cart = cartOf([line({})], { unavailableItems: [{ id: 'gone', productName: 'Sữa tắm cũ', variationName: '', quantity: 1 }] });
    state.remove = hold;
    const { container } = await mount();
    const del = btn(container, 'Xoá Sữa tắm cũ khỏi giỏ hàng');
    clickTwice(del);
    await flush(2);
    expect(state.removed).toEqual(['gone']);
    expect(del.getAttribute('aria-busy')).toBe('true');
    expect(del.getAttribute('aria-disabled')).toBe('true');
    await act(async () => deferred[0]!.resolve(state.cart));
    await flush(4);
    expect(btn(container, 'Xoá Sữa tắm cũ khỏi giỏ hàng').hasAttribute('aria-busy')).toBe(false);
  });

  it('xoá dòng A (còn bay) rồi chạm "+" dòng B: xoá xong vẫn hiện thanh Hoàn tác của A (không phụ thuộc lệnh sau cùng)', async () => {
    state.cart = cartOf([line({}), line(LINE_B)]);
    state.remove = hold;
    state.update = hold;
    const { container } = await mount();
    click(trashA(container));
    await flush(2);
    click(plusB(container));
    await flush(2);
    expect(deferred).toHaveLength(2);
    await act(async () => deferred[0]!.resolve(state.cart));
    await flush(4);
    expect(undoButton(container)).toBeDefined();
    click(undoButton(container)!);
    await flush(4);
    expect(state.added).toEqual([{ variationId: 'v1', quantity: 2 }]);
  });

  it('bấm "Hoàn tác" hai lần trong cùng một act: chỉ MỘT lần thêm lại (không nhân đôi số lượng)', async () => {
    const { container } = await mount();
    click(trashA(container));
    await flush(4);
    clickTwice(undoButton(container)!);
    await flush(4);
    expect(state.added).toEqual([{ variationId: 'v1', quantity: 2 }]);
  });

  it('Hoàn tác thành công cũng nhả khoá: xoá lại rồi Hoàn tác lần nữa vẫn thêm lại được', async () => {
    const { container } = await mount();
    click(trashA(container));
    await flush(4);
    click(undoButton(container)!);
    await flush(4);
    click(trashA(container));
    await flush(4);
    click(undoButton(container)!);
    await flush(4);
    expect(state.added).toHaveLength(2);
  });

  it('Hoàn tác lỗi thì nhả khoá: lần xoá và hoàn tác sau vẫn gửi được', async () => {
    state.add = async () => {
      throw new Error('Hết hàng rồi');
    };
    const { container } = await mount();
    click(trashA(container));
    await flush(4);
    click(undoButton(container)!);
    await flush(4);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Hết hàng rồi');
    state.add = async () => state.cart;
    click(trashA(container));
    await flush(4);
    // Xoá lại thành công thì lời báo lỗi Hoàn tác của lần trước mất.
    expect(container.querySelector('[role="alert"]')).toBeNull();
    click(undoButton(container)!);
    await flush(4);
    expect(state.added).toHaveLength(2);
  });
});

describe('/gio-hang — tải giỏ lỗi (W81B, W98B)', () => {
  it('giỏ đã có dòng rồi tải lại nền lỗi: giữ giỏ đang xem và thanh Thanh toán, không thay bằng màn lỗi', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const r = render(<CartPage />, qc);
    mounted.push(r);
    await flush(6);
    expect(plusA(r.container)).not.toBeNull();
    const bar = () => r.container.querySelector('[data-testid="sticky-bar"]');
    expect(bar()).not.toBeNull();
    const before = state.cartCalls;
    state.cartError = new Error('Mạng lỗi');
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['cart'] });
    });
    await flush(4);
    expect(state.cartCalls).toBeGreaterThan(before);
    expect(plusA(r.container)).not.toBeNull();
    expect(bar()).not.toBeNull();
    expect([...r.container.querySelectorAll('button')].some((b) => b.textContent === 'Thử lại')).toBe(false);
  });

  it('giỏ chưa từng tải được: màn lỗi có "Thử lại", chạm đúp trong cùng một khung hình chỉ gọi giỏ thêm một lần, rồi hiện giỏ', async () => {
    state.cartError = new Error('Mạng lỗi');
    const r = render(<CartPage />);
    mounted.push(r);
    await flush(6);
    const retryBtn = () => [...r.container.querySelectorAll('button')].find((b) => b.textContent === 'Thử lại')!;
    expect(retryBtn()).toBeDefined();
    const before = state.cartCalls;
    state.cartError = null;
    clickTwice(retryBtn());
    await flush(6);
    expect(state.cartCalls).toBe(before + 1);
    expect(retryBtn()).toBeUndefined();
    expect(plusA(r.container)).not.toBeNull();
  });
});
