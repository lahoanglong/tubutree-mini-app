// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Cùng ý nghĩa pdp-rebuy của Mini App: dòng "Bạn đã mua ngày dd/mm · Mua lại" một chạm thêm đúng phân loại lần trước, số lượng 1.
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), phase: 'authenticated', stock: {} as Record<string, number> }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [], useRunningFlash: () => ({ flash: [], now: Date.now() }) }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, useCartKey: () => ['cart', null], cartKey: () => ['cart', null] }));
vi.mock('@/components/pdp-stock', () => ({ useProductStock: () => ({ data: mocks.stock }) }));

import { PdpRebuyRow } from './pdp-rebuy';

const VARIATIONS = [
  { id: 'v1', name: '250ml', stock: 5 },
  { id: 'v2', name: '500ml', stock: 5 },
];
const bought = (over: Record<string, unknown> = {}) => ({
  variationId: 'v2', productId: 'p1', slug: 'dau-goi', productName: 'Dầu gội', variationName: '500ml', brand: 'Tubu', thumbnail: null,
  price: 100000, salePrice: null, stock: 5, inStock: true, timesBought: 1, lastPurchasedAt: '2026-10-05T03:00:00.000Z', ...over,
});
const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 1 };

let items: unknown[] = [];
let mounted: Rendered[] = [];
const mount = async (props: Partial<React.ComponentProps<typeof PdpRebuyRow>> = {}) => {
  const r = render(<PdpRebuyRow productId="p1" slug="dau-goi" productName="Dầu gội" variations={VARIATIONS} {...props} />);
  mounted.push(r);
  await flush(6);
  return r.container;
};

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.stock = {};
  items = [bought()];
  mocks.get.mockReset().mockImplementation(async (path: string) => (String(path).startsWith('/cart') ? { items: [] } : { items, nextCursor: null }));
  mocks.post.mockReset().mockResolvedValue(CART);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('PdpRebuyRow', () => {
  it('đã mua món này: hiện ngày mua lần gần nhất và nút phụ "Mua lại" có tên đọc nêu phân loại; vùng chạm 44px', async () => {
    items = [bought({ variationId: 'v1', lastPurchasedAt: '2026-08-01T03:00:00.000Z' }), bought()];
    const c = await mount();
    const row = c.querySelector('[data-pdp-block="rebuy"]')!;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('Bạn đã mua ngày 05/10');
    const btn = c.querySelector<HTMLButtonElement>('[data-testid="pdp-rebuy"]')!;
    expect(btn.textContent).toBe('Mua lại');
    expect(btn.getAttribute('aria-label')).toBe('Mua lại phân loại 500ml đã mua ngày 05/10');
    expect(mocks.get.mock.calls.find((x) => x[0] === '/me/purchased-items')?.[1]).toMatchObject({ query: { limit: 50 } });
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });

  it('bấm "Mua lại": thêm đúng phân loại lần trước, số lượng 1, một lần dù chạm đúp', async () => {
    let resolve!: (v: unknown) => void;
    mocks.post.mockImplementation(() => new Promise((r) => (resolve = r)));
    const c = await mount();
    const btn = c.querySelector<HTMLButtonElement>('[data-testid="pdp-rebuy"]')!;
    click(btn);
    click(btn);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![0]).toBe('/cart/items');
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ variationId: 'v2', quantity: 1, addSource: 'repurchase' });
    resolve(CART);
    await flush(4);
    expect(byText(document.body, 'span', 'Đã thêm vào giỏ!')).not.toBeNull();
  });

  it.each([
    ['khách chưa đăng nhập', () => (mocks.phase = 'guest')],
    ['chưa mua món này', () => (items = [bought({ productId: 'p9' })])],
    ['phân loại lần trước đã hết hàng (tồn mới nhất)', () => (mocks.stock = { v2: 0 })],
    ['phân loại lần trước không còn trên trang', () => (items = [bought({ variationId: 'v-old' })])],
  ])('%s: không có dòng, không để lại phần tử rỗng', async (_name, arrange) => {
    arrange();
    const c = await mount();
    expect(c.querySelector('[data-pdp-block="rebuy"]')).toBeNull();
    expect(c.querySelector('[data-testid="pdp-rebuy"]')).toBeNull();
    expect(c.innerHTML).toBe('');
  });

  it('gian hàng tạm nghỉ: không mời mua lại', async () => {
    const c = await mount({ blocked: true });
    expect(c.querySelector('[data-pdp-block="rebuy"]')).toBeNull();
  });
});

describe('PdpRebuyRow: gói Refill không nằm trong dòng Mua lại (tubu-w13-01)', () => {
  it('khách đã nhận chai: dòng chỉ có nút Mua lại, thẻ Refill là khối riêng của trang', async () => {
    const c = await mount();
    expect(c.querySelector('[data-pdp-block="rebuy"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="pdp-refill"]')).toBeNull();
    expect(c.querySelectorAll('a')).toHaveLength(0);
  });
});
