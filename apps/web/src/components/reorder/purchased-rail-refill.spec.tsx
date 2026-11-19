// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  on: true,
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
  pairs: vi.fn<(ids: readonly string[]) => Promise<unknown>>(),
  track: vi.fn(),
}));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [], useRunningFlash: () => ({ flash: [], now: Date.now() }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, useCartKey: () => ['cart', null], cartKey: () => ['cart', null] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/shop-client')>()), getCart: async () => ({ items: [] }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/' }));
vi.mock('@tubutree/app-core/queries/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tubutree/app-core/queries/config')>()),
  publicConfigQuery: () => ({
    queryKey: ['public-config'],
    queryFn: async () => ({ ...(await import('@/lib/use-public-config')).PUBLIC_CONFIG_FALLBACK, refillFirstEnabled: mocks.on }),
  }),
}));
vi.mock('@tubutree/app-core/refill/refill-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tubutree/app-core/refill/refill-api')>()),
  myRefillPairsQuery: (_http: unknown, ids: readonly string[]) => ({
    queryKey: ['refill-pairs', 'mine', ids.join(',')],
    queryFn: () => mocks.pairs(ids),
    retry: false,
  }),
}));
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackWebEvent: (...a: unknown[]) => mocks.track(...a),
}));

import { PurchasedRail } from './purchased-rail';

const bought = (i: number) => ({
  variationId: `v${i}`, productId: `p${i}`, slug: `sp-${i}`, productName: `Chai ${i}`, variationName: null, brand: 'Fuwa3e', thumbnail: null,
  price: 60_000, salePrice: null, stock: 8, inStock: true, timesBought: 1, retailOnly: false, lastPurchasedAt: '2026-10-10T00:00:00.000Z',
});
const OFFER = { productId: 'p-r', slug: 'refill-10l', name: 'Nước rửa chén Fuwa3e 10L', thumbnail: null, variationId: 'v-r', price: 650_000, compareAt: null, sizeLabel: '10L', inStock: true, tubu: true };
const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199_000, itemCount: 0 };

let mounted: Rendered | null = null;
const home = async () => {
  mounted = render(<PurchasedRail source="home_rail" />);
  await flush(10);
  return mounted.container;
};
const ids = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-testid="quick-reorder-card"]')).map((el) => el.getAttribute('data-variation-id'));

beforeEach(() => {
  localStorage.clear();
  mocks.on = true;
  mocks.get.mockReset().mockImplementation((path: string) => (String(path).startsWith('/cart') ? Promise.resolve({ items: [] }) : Promise.resolve({ items: [bought(0), bought(1)], nextCursor: null })));
  mocks.post.mockReset().mockResolvedValue(CART);
  mocks.push.mockReset();
  mocks.pairs.mockReset().mockResolvedValue({ p0: OFFER });
  mocks.track.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('web: dải "Mua lại món quen", chai khách đã có thành gói Refill (catalog.refill_first_enabled)', () => {
  it('cờ tắt: không hỏi cặp, dải như cũ', async () => {
    mocks.on = false;
    const c = await home();
    expect(ids(c)).toEqual(['v0', 'v1']);
    expect(mocks.pairs).not.toHaveBeenCalled();
  });

  it('ô chai thành gói Refill; "+ Thêm" thêm đúng gói refill (addSource repurchase) và ghi sự kiện', async () => {
    const c = await home();
    expect(ids(c)).toEqual(['v-r', 'v1']);
    expect(mocks.pairs).toHaveBeenCalledWith(['p0', 'p1']);
    const card = c.querySelector('[data-testid="quick-reorder-card"]')!;
    expect(card.textContent).toContain('Nước rửa chén Fuwa3e 10L');
    expect(card.textContent).toContain('650.000đ');
    expect(card.textContent).toContain('Đổi sang túi Refill 10L');
    const add = card.querySelector('[data-testid="quick-reorder-add"]')!;
    expect(add.textContent).toBe('+ Thêm Refill');
    expect(add.getAttribute('aria-label')).toBe('Thêm Refill 10L thay cho Chai 0 vào giỏ, 650.000đ');
    expect([...c.querySelectorAll('button')].some((b) => /, gồm 1 túi Refill$/.test(b.getAttribute('aria-label') ?? ''))).toBe(true);
    expect(mocks.track).toHaveBeenCalledWith('refill_swap_shown', { surface: 'reorder' });
    click(card.querySelector('[data-testid="quick-reorder-add"]'));
    await flush(6);
    expect(mocks.post).toHaveBeenCalledWith('/cart/items', { variationId: 'v-r', quantity: 1, addSource: 'repurchase' }, undefined);
    expect(mocks.track).toHaveBeenCalledWith('refill_swap_applied', { surface: 'reorder' });
  });

  it('mở ô Refill: tấm Mua lại của đúng chai cũ, không sang trang gói refill', async () => {
    const c = await home();
    click(c.querySelector('[data-testid="quick-reorder-card"] .tubu-quick-open'));
    await flush(6);
    expect(mocks.push).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain('Chai 0');
  });
});
