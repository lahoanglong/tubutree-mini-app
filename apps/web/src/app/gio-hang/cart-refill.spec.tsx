// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const state = vi.hoisted(() => ({
  on: true,
  cart: null as unknown,
  order: [] as string[],
  afterAdd: null as unknown,
  afterRemove: null as unknown,
  pairs: vi.fn<(ids: readonly string[]) => Promise<unknown>>(),
  track: vi.fn(),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/use-public-config', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/use-public-config')>();
  return { ...real, usePublicConfig: () => ({ ...real.PUBLIC_CONFIG_FALLBACK, refillFirstEnabled: state.on, isLoaded: true, isPending: false }) };
});
vi.mock('@tubutree/app-core/refill/refill-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tubutree/app-core/refill/refill-api')>()),
  myRefillPairsQuery: (_http: unknown, ids: readonly string[]) => ({
    queryKey: ['refill-pairs', 'mine', ids.join(',')],
    queryFn: () => state.pairs(ids),
    retry: false,
  }),
}));
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackWebEvent: (...a: unknown[]) => state.track(...a),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => state.cart,
  getMyCoupons: async () => [],
  getCouponPreviews: async () => [],
  getCartSelection: async () => {
    throw new Error('chưa mock');
  },
  addToCart: async (v: string, q: number) => {
    state.order.push(`add:${v}x${q}`);
    state.cart = state.afterAdd;
    return state.afterAdd;
  },
  removeCartItem: async (id: string) => {
    state.order.push(`remove:${id}`);
    state.cart = state.afterRemove;
    return state.afterRemove;
  },
}));

import CartPage from './cart-page';

const BOTTLE = {
  id: 'ci-bottle', productId: 'p-bottle', variationId: 'v-bottle', productName: 'Nước rửa chén Fuwa3e 500ml', variationName: null, slug: 'nrc-500',
  thumbnail: null, unitPrice: 60_000, quantity: 2, stock: 9, total: 120_000,
};
const REFILL_LINE = { ...BOTTLE, id: 'ci-refill', productId: 'p-refill', variationId: 'v-refill', productName: 'Nước rửa chén Fuwa3e 10L', slug: 'nrc-10l', unitPrice: 650_000, quantity: 1, total: 650_000 };
const OFFER = { productId: 'p-refill', slug: 'nrc-10l', name: 'Nước rửa chén Fuwa3e 10L', thumbnail: null, variationId: 'v-refill', price: 650_000, compareAt: null, sizeLabel: '10L', inStock: true, tubu: true };
const cartOf = (items: readonly (Record<string, unknown> & { total: number })[]) => ({
  items, couponCode: null, subtotal: items.reduce((s, it) => s + it.total, 0), discount: 0, freeship: false, freeshipThreshold: 199_000, itemCount: items.length,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CartPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const link = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-testid="refill-swap-link"]');
const buttonByText = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text) ?? null;

beforeEach(() => {
  sessionStorage.clear();
  state.on = true;
  state.order = [];
  state.cart = cartOf([BOTTLE]);
  state.pairs.mockReset();
  state.pairs.mockResolvedValue({ 'p-bottle': OFFER });
  state.track.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/gio-hang: đổi dòng chai sang gói Refill (catalog.refill_first_enabled)', () => {
  it('cờ tắt: không hỏi cặp refill, không có liên kết (hành vi cũ)', async () => {
    state.on = false;
    const { container } = await mount();
    expect(container.textContent).toContain('Nước rửa chén Fuwa3e 500ml');
    expect(state.pairs).not.toHaveBeenCalled();
    expect(link(container)).toBeNull();
  });

  it('liên kết chữ ghi giá gói và phần tăng; xác nhận thì thêm gói rồi mới bỏ chai; Hoàn tác trả lại đúng chai', async () => {
    const { container } = await mount();
    expect(state.pairs).toHaveBeenCalledWith(['p-bottle']);
    expect(link(container)!.textContent).toBe('Đã có chai? Đổi sang Refill 10L · 650.000đ (+530.000đ)');
    expect(state.track).toHaveBeenCalledWith('refill_swap_shown', { surface: 'cart' });

    click(link(container));
    await flush();
    expect(document.body.textContent).toContain('Đổi sang Refill?');
    expect(state.order).toEqual([]);

    state.afterAdd = cartOf([BOTTLE, REFILL_LINE]);
    state.afterRemove = cartOf([REFILL_LINE]);
    click(buttonByText('Đổi sang Refill'));
    await flush(8);
    expect(state.order).toEqual(['add:v-refillx1', 'remove:ci-bottle']);
    expect(container.querySelector('[data-testid="refill-undo"]')?.textContent).toContain('Đã đổi sang Refill');
    expect(state.track).toHaveBeenCalledWith('refill_swap_applied', { surface: 'cart' });

    state.order = [];
    state.afterAdd = cartOf([REFILL_LINE, BOTTLE]);
    state.afterRemove = cartOf([BOTTLE]);
    click(container.querySelector<HTMLButtonElement>('[data-testid="refill-undo"] button'));
    await flush(8);
    expect(state.order).toEqual(['add:v-bottlex2', 'remove:ci-refill']);
    expect(state.track).toHaveBeenCalledWith('refill_swap_undone', { surface: 'cart' });
  });

  it('gói refill hết hàng: không mời đổi', async () => {
    state.pairs.mockResolvedValue({ 'p-bottle': { ...OFFER, inStock: false } });
    const { container } = await mount();
    expect(state.pairs).toHaveBeenCalled();
    expect(link(container)).toBeNull();
  });

  it('gói rẻ hơn dòng chai và không mất mốc: đổi ngay một chạm, không hộp xác nhận', async () => {
    const many = { ...BOTTLE, quantity: 12, total: 720_000 };
    state.cart = cartOf([many]);
    state.afterAdd = cartOf([many, REFILL_LINE]);
    state.afterRemove = cartOf([REFILL_LINE]);
    const { container } = await mount();
    expect(link(container)!.textContent).toBe('Đã có chai? Đổi sang Refill 10L · 650.000đ');
    click(link(container));
    await flush(8);
    expect(document.body.textContent).not.toContain('Đổi sang Refill?');
    expect(state.order).toEqual(['add:v-refillx1', 'remove:ci-bottle']);
  });

  it('đổi làm giỏ rơi dưới mốc Miễn phí giao hàng: hộp xác nhận nói trước số còn thiếu', async () => {
    state.cart = cartOf([{ ...BOTTLE, quantity: 5, total: 300_000 }]);
    state.pairs.mockResolvedValue({ 'p-bottle': { ...OFFER, price: 150_000 } });
    const { container } = await mount();
    click(link(container));
    await flush();
    expect(document.body.textContent).toContain('Giỏ sẽ thiếu 49.000đ để Miễn phí giao hàng');
  });
});
