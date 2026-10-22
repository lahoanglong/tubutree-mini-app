// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { recallCheckoutSelection } from '@/lib/checkout-selection';

// BUYERWEB-10: bấm "+" trên dòng hết hàng làm dòng bị xoá (quantity kẹp về 0) mà không báo gì.
// BUYERWEB-11: tên sản phẩm dài không khoảng trắng làm giỏ tràn ngang ở 390px.

const state = vi.hoisted(() => ({
  cart: null as unknown,
  updates: [] as { id: string; q: number }[],
  removed: [] as string[],
  added: [] as { variationId: string; quantity: number }[],
  removeError: null as Error | null,
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
    return state.cart;
  },
  removeCartItem: async (id: string) => {
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
    click(button(container, 'Xóa Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    expect(container.textContent).toContain('Đã bỏ khỏi giỏ');
    click(undoButton(container)!);
    await flush();
    expect(state.added).toEqual([{ variationId: 'v1', quantity: 2 }]);
    expect(undoButton(container)).toBeUndefined();
  });

  it('hộp hoàn tác ở điện thoại nằm trên thanh dính theo chiều cao đo được, không cố định 128px', async () => {
    const { container } = await mount();
    click(button(container, 'Xóa Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    const box = container.querySelector<HTMLElement>('[role="status"].fixed')!;
    expect(box.className).not.toMatch(/\bbottom-32\b/);
    expect(box.className).toContain('--sticky-bar-h');
  });

  it('thanh hoàn tác tự tắt sau 3,5 giây', async () => {
    const { container } = await mount();
    vi.useFakeTimers();
    click(button(container, 'Xóa Dầu gội bồ kết khỏi giỏ hàng'));
    await vi.advanceTimersByTimeAsync(50);
    expect(undoButton(container)).toBeDefined();
    await vi.advanceTimersByTimeAsync(3600);
    expect(undoButton(container)).toBeUndefined();
  });

  it('xoá lỗi (máy chủ từ chối) → không có thanh hoàn tác', async () => {
    state.removeError = new Error('Không xoá được');
    const { container } = await mount();
    click(button(container, 'Xóa Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    expect(undoButton(container)).toBeUndefined();
  });

  it('hoàn tác lỗi → báo lỗi, thanh hoàn tác đã đóng', async () => {
    state.addError = new Error('Hết hàng rồi');
    const { container } = await mount();
    click(button(container, 'Xóa Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    click(undoButton(container)!);
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Hết hàng rồi');
    expect(undoButton(container)).toBeUndefined();
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

