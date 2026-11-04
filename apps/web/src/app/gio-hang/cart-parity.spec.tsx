// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { recallCheckoutSelection } from '@/lib/checkout-selection';
import { cartComboBlocks, comboHeadingText } from '@tubutree/app-core/commerce/cart-combo';

// BUYERWEB-10: bấm "+" trên dòng hết hàng làm dòng bị xoá (quantity kẹp về 0) mà không báo gì.
// BUYERWEB-11: tên sản phẩm dài không khoảng trắng làm giỏ tràn ngang ở 390px.

const state = vi.hoisted(() => ({
  cart: null as unknown,
  updates: [] as { id: string; q: number }[],
  removed: [] as string[],
  added: [] as { variationId: string; quantity: number }[],
  removeError: null as Error | null,
  hang: false,
  removeGate: null as Promise<void> | null,
  addError: null as Error | null,
  coupons: [] as unknown[],
  previews: vi.fn<(p: unknown) => Promise<unknown[]>>(),
  selection: vi.fn<(ids: string[]) => Promise<unknown>>(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => state.cart,
  getMyCoupons: async () => state.coupons,
  getCouponPreviews: (p: unknown) => state.previews(p),
  getCartSelection: (ids: string[]) => state.selection(ids),
  applyCoupon: async () => state.cart,
  removeCoupon: async () => state.cart,
  updateCartItem: async (id: string, q: number) => {
    state.updates.push({ id, q });
    if (state.hang) return new Promise(() => undefined);
    return state.cart;
  },
  removeCartItem: async (id: string) => {
    if (state.removeGate) await state.removeGate;
    if (state.removeError) throw state.removeError;
    state.removed.push(id);
    return state.cart;
  },
  addToCart: async (variationId: string, quantity: number) => {
    if (state.addError) throw state.addError;
    state.added.push({ variationId, quantity });
    return state.cart;
  },
}));

import CartPage from './page';

const line = (over: Record<string, unknown>) => ({
  id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết', variationName: '500ml', slug: 'dau-goi', thumbnail: null,
  unitPrice: 150000, quantity: 2, stock: 5, total: 300000, ...over,
});
const cartOf = (items: unknown[]) => ({
  items, couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 2,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CartPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const button = (c: HTMLElement, label: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

const undoButton = (c: HTMLElement) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Hoàn tác');

beforeEach(() => {
  sessionStorage.clear();
  state.updates = [];
  state.removed = [];
  state.added = [];
  state.removeError = null;
  state.hang = false;
  state.removeGate = null;
  state.addError = null;
  state.cart = cartOf([line({})]);
  state.coupons = [];
  state.previews.mockReset();
  state.previews.mockResolvedValue([]);
  state.selection.mockReset();
  state.selection.mockRejectedValue(new Error('chưa mock'));
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/gio-hang — xoá có hoàn tác, liên kết sản phẩm, suất giờ vàng (như Mini App)', () => {
  afterEach(() => vi.useRealTimers());

  it('xoá xong hiện "Đã bỏ khỏi giỏ" kèm Hoàn tác; bấm Hoàn tác thêm lại đúng phân loại và số lượng đã xoá', async () => {
    const { container } = await mount();
    click(button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    expect(container.textContent).toContain('Đã bỏ khỏi giỏ');
    click(undoButton(container)!);
    await flush();
    expect(state.added).toEqual([{ variationId: 'v1', quantity: 2 }]);
    expect(undoButton(container)).toBeUndefined();
  });

  it('hộp hoàn tác ở điện thoại nằm trên thanh dính theo chiều cao đo được, không cố định 128px', async () => {
    const { container } = await mount();
    click(button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    const box = container.querySelector<HTMLElement>('[role="status"] .fixed')!;
    expect(box.className).not.toMatch(/\bbottom-32\b/);
    expect(box.className).toContain('--sticky-bar-h');
  });

  it('A11Y-05: thanh hoàn tác tự tắt sau 10 giây (không phải 3,5 giây), và còn mở ở giây thứ 9', async () => {
    const { container } = await mount();
    vi.useFakeTimers();
    click(button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng'));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(undoButton(container)).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(undoButton(container)).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(undoButton(container)).toBeUndefined();
  });

  it('A11Y-05: xoá xong, focus chuyển sang nút Hoàn tác; đồng hồ dừng khi focus ở trong thanh, rời đi thì đếm lại đủ 10 giây', async () => {
    const { container } = await mount();
    vi.useFakeTimers();
    const remove = button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng')!;
    remove.focus();
    // jsdom không có :focus-visible (nút vừa nhận focus bằng bàn phím thì trình duyệt thật trả true).
    const realMatches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
      return sel === ':focus-visible' ? this === remove : realMatches.call(this, sel);
    });
    click(remove);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(document.activeElement).toBe(undoButton(container));
    vi.restoreAllMocks();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(undoButton(container)).toBeDefined();
    const bar = container.querySelector<HTMLElement>('[role="status"] .fixed')!;
    act(() => { undoButton(container)!.blur(); bar.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(undoButton(container)).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(undoButton(container)).toBeUndefined();
  });

  it('hoàn tác bằng bàn phím: thanh biến mất thì focus sang dòng vừa thêm lại; không thấy dòng thì sang tiêu đề trang; chuột không kéo focus', async () => {
    const realMatches = Element.prototype.matches;
    const asKeyboard = () =>
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
        return sel === ':focus-visible' ? this === document.activeElement : realMatches.call(this, sel);
      });
    const { container } = await mount();
    click(button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    asKeyboard();
    undoButton(container)!.focus();
    click(undoButton(container)!);
    await flush();
    const restored = container.querySelector<HTMLElement>('[data-testid="cart-line"][data-variation-id="v1"]')!;
    expect(document.activeElement).toBe(restored.querySelector('input[type="checkbox"]'));
    vi.restoreAllMocks();

    click(button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    state.cart = cartOf([line({ id: 'i2', variationId: 'v2', productName: 'Xà phòng' })]);
    asKeyboard();
    undoButton(container)!.focus();
    click(undoButton(container)!);
    await flush();
    expect(document.activeElement).toBe(container.querySelector('main h1'));
    vi.restoreAllMocks();

    (document.activeElement as HTMLElement).blur();
    click(button(container, 'Xoá Xà phòng khỏi giỏ hàng'));
    await flush();
    click(undoButton(container)!);
    await flush();
    expect(document.activeElement).toBe(document.body);
  });

  it('xoá bằng bàn phím nhưng máy chủ trả chậm: khách đã Tab sang ô khác thì focus không nhảy sang Hoàn tác', async () => {
    let release!: () => void;
    state.removeGate = new Promise<void>((r) => { release = r; });
    const { container } = await mount();
    const realMatches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
      return sel === ':focus-visible' ? this === document.activeElement : realMatches.call(this, sel);
    });
    const remove = button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng')!;
    remove.focus();
    click(remove);
    const other = document.createElement('input');
    container.appendChild(other);
    other.focus();
    release();
    await flush();
    expect(undoButton(container)).toBeDefined();
    expect(document.activeElement).toBe(other);
    vi.restoreAllMocks();
    other.remove();
  });

  it('hoàn tác bằng bàn phím nhưng phản hồi về chậm: khách đã focus sang ô khác thì không bị kéo focus về dòng', async () => {
    const { container } = await mount();
    click(button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    const realMatches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
      return sel === ':focus-visible' ? this === document.activeElement : realMatches.call(this, sel);
    });
    undoButton(container)!.focus();
    const other = document.createElement('input');
    container.appendChild(other);
    click(undoButton(container)!);
    other.focus();
    await flush();
    expect(document.activeElement).toBe(other);
    vi.restoreAllMocks();
    other.remove();
  });

  it('A11Y-05: xoá bằng chuột (nút không có vòng lấy nét) thì không kéo focus sang Hoàn tác, thanh vẫn tự tắt sau 10 giây', async () => {
    const { container } = await mount();
    vi.useFakeTimers();
    click(button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng'));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(document.activeElement).not.toBe(undoButton(container));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
    expect(undoButton(container)).toBeUndefined();
  });

  it('A11Y-05: rê chuột lên thanh cũng dừng đồng hồ', async () => {
    const { container } = await mount();
    vi.useFakeTimers();
    click(button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng'));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const bar = container.querySelector<HTMLElement>('[role="status"] .fixed')!;
    act(() => { undoButton(container)!.blur(); bar.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body })); });
    act(() => { bar.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(undoButton(container)).toBeDefined();
    act(() => { bar.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
    expect(undoButton(container)).toBeUndefined();
  });

  it('xoá lỗi (máy chủ từ chối) → không có thanh hoàn tác', async () => {
    state.removeError = new Error('Không xoá được');
    const { container } = await mount();
    click(button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    expect(undoButton(container)).toBeUndefined();
  });

  it('hoàn tác lỗi → báo lỗi, thanh hoàn tác đã đóng', async () => {
    state.addError = new Error('Hết hàng rồi');
    const { container } = await mount();
    click(button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    click(undoButton(container)!);
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Hết hàng rồi');
    expect(undoButton(container)).toBeUndefined();
  });

  it('A11Y-03: bấm "+" khi máy chủ chưa trả lời: nút chỉ aria-disabled, vẫn giữ focus, bấm thêm không gửi lần hai', async () => {
    state.hang = true;
    const { container } = await mount();
    const plus = button(container, 'Tăng số lượng Dầu gội bồ kết')!;
    plus.focus();
    click(plus);
    await flush();
    expect(state.updates).toEqual([{ id: 'i1', q: 3 }]);
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    expect(plus.disabled).toBe(false);
    expect(document.activeElement).toBe(plus);
    click(plus);
    click(button(container, 'Giảm số lượng Dầu gội bồ kết')!);
    expect(state.updates).toHaveLength(1);
    const trash = button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng')!;
    click(trash);
    expect(state.removed).toEqual([]);
    expect(trash.getAttribute('aria-disabled')).toBe('true');
  });

  it('A11Y-02: vùng báo hoàn tác có sẵn trong cây trước khi xoá; sau khi xoá, chính nút đó chứa thanh "Đã bỏ khỏi giỏ"', async () => {
    const { container } = await mount();
    const region = container.querySelector('[data-testid="undo-region"]')!;
    expect(region).not.toBeNull();
    expect(region.textContent).toBe('');
    click(button(container, 'Xoá Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    expect(region.isConnected).toBe(true);
    expect(region.textContent).toContain('Đã bỏ khỏi giỏ');
    expect(region.querySelector('[data-surface="inverse"]')).not.toBeNull();
  });

  it('tên và ảnh sản phẩm là liên kết tới trang sản phẩm', async () => {
    const { container } = await mount();
    const links = [...container.querySelectorAll('a[href="/san-pham/dau-goi"]')];
    expect(links.length).toBe(2);
    expect(links.some((a) => a.textContent === 'Dầu gội bồ kết')).toBe(true);
  });

  it('dòng giờ vàng: hiện "Đã bán N%" kẹp trong 0–100', async () => {
    state.cart = cartOf([line({ isFlash: true, soldPct: 64.4 })]);
    const a = await mount();
    expect(a.container.textContent).toContain('Đã bán 64%');
    state.cart = cartOf([line({ isFlash: true, soldPct: 150 })]);
    const b = await mount();
    expect(b.container.textContent).toContain('Đã bán 100%');
  });
});


describe('/gio-hang — đầu nhóm combo giống Mini App (K5)', () => {
  it('chữ đầu nhóm và chữ nhắc là đúng chữ của cartComboBlocks/comboHeadingText mà Mini App dùng', async () => {
    const items = [line({ id: 'i1', variationId: 'v1', productName: 'Xà bông', slug: 'xb' }), line({ id: 'i2', variationId: 'v2', productName: 'Dầu gội', slug: 'dg' })];
    const comboGroups = [{ id: 'collection:c1', kind: 'STOREFRONT' as const, title: 'Bộ giặt sạch Fuwa3e', discount: 65250, lineIds: ['i1', 'i2'], keyLineIds: ['i1', 'i2'] }];
    state.cart = { ...cartOf(items), comboDiscount: 65250, comboGroups };
    const { container } = await mount();
    const [applied] = cartComboBlocks(items, comboGroups).blocks;
    expect(container.querySelector('[data-testid="cart-combo-heading"]')!.textContent).toBe(comboHeadingText(applied!));
    expect(container.querySelector('[data-testid="cart-combo-heading"]')!.textContent).toBe('Combo: Bộ giặt sạch Fuwa3e · Tiết kiệm 65.250đ');
    click(container.querySelector<HTMLInputElement>('input[type="checkbox"][aria-label="Chọn Xà bông để thanh toán"]'));
    await flush();
    const [unapplied] = cartComboBlocks(items, comboGroups, new Set(['i1'])).blocks;
    expect(container.querySelector('[data-testid="cart-combo-heading"]')!.textContent).toBe(comboHeadingText(unapplied!));
    expect(container.querySelector('[data-testid="cart-combo-hint"]')!.textContent).toBe(unapplied!.hint);
  });
});
