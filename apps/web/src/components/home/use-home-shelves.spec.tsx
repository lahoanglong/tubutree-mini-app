// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ get: vi.fn(), phase: 'authenticated' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));

import type { HomeKindState } from '@tubutree/app-core/home-layout';
import { resetFlashSales } from '@/lib/use-flash-sales';
import { useHomeShelves, type HomeShelves } from './use-home-shelves';

const HOUR = 3_600_000;
const flashItem = (slug: string, i: number) => ({
  itemId: `f${i}`, variationId: `v${i}`, productSlug: slug, productName: slug, thumbnail: null,
  retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 1, endAt: new Date(Date.now() + HOUR).toISOString(),
});
const card = (slug: string) => ({ id: `p-${slug}`, slug, name: slug, brand: 'B', thumbnail: null, basePrice: 1000, salePrice: null, repVariationId: `rv-${slug}`, isFeatured: false, inStock: true });
const purchased = (slug: string) => ({
  productId: `p-${slug}`, variationId: `pv-${slug}`, slug, productName: slug, variationName: null, brand: 'B', thumbnail: null,
  price: 1000, salePrice: null, stock: 5, inStock: true, timesBought: 1,
});

let latest: HomeShelves | null = null;
function Probe({ kind }: { kind: HomeKindState }) {
  latest = useHomeShelves(kind);
  return null;
}

let mounted: Rendered | null = null;
async function mount(kind: HomeKindState) {
  mounted = render(<Probe kind={kind} />);
  await flush(8);
  return latest!;
}

beforeEach(() => {
  resetFlashSales();
  latest = null;
  mocks.phase = 'authenticated';
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/flash-sales/active') return ['a', 'b', 'a', 'c'].map(flashItem);
    if (path.startsWith('/products')) return { data: ['a', 'x', 'y', 'z', 'w'].map(card), meta: { page: 1, limit: 12, total: 5 } };
    if (path.includes('purchased')) return { items: ['b', 'q'].map(purchased), meta: { page: 1, limit: 10, total: 2 } };
    return [];
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('useHomeShelves (web)', () => {
  it('Bán chạy nhất xin sort=best_seller_30d, 12 món', async () => {
    await mount('new');
    const call = mocks.get.mock.calls.find(([p]) => String(p).startsWith('/products'));
    expect(call).toBeTruthy();
    expect(JSON.stringify(call)).toContain('best_seller_30d');
    expect(JSON.stringify(call)).toContain('12');
  });

  it('Giờ vàng một thẻ mỗi sản phẩm; Bán chạy bỏ món đã ở Giờ vàng; seen gồm mọi món đang hiện', async () => {
    const s = await mount('new');
    expect(s.flash.map((f) => f.productSlug)).toEqual(['a', 'b', 'c']);
    expect(s.bestSellers.map((p) => p.slug)).toEqual(['x', 'y', 'z', 'w']);
    expect(Array.from(s.flashSlugs).sort()).toEqual(['a', 'b', 'c']);
    expect(s.seen.has('a') && s.seen.has('x')).toBe(true);
  });

  it('khách cũ: món Mua lại cũng nằm trong seen (trừ món đã ở Giờ vàng); khách mới không gọi kệ Mua lại', async () => {
    const returning = await mount('returning');
    expect(returning.seen.has('q')).toBe(true);
    mounted!.unmount();
    mocks.get.mockClear();
    resetFlashSales();
    latest = null;
    const fresh = await mount('new');
    expect(fresh.seen.has('q')).toBe(false);
  });

  it('dữ liệu dựng sẵn của máy chủ có ngay ở lần vẽ đầu (HTML đầu có kệ)', () => {
    function Initial() {
      latest = useHomeShelves('new', { flash: ['a', 'b', 'c'].map(flashItem), bestSellers: { data: ['x', 'y', 'z'].map(card), meta: { page: 1, limit: 12, total: 3 } } });
      return null;
    }
    mounted = render(<Initial />);
    expect(latest!.flash).toHaveLength(3);
    expect(latest!.bestSellers).toHaveLength(3);
    expect(latest!.flashQuery.isLoading).toBe(false);
  });
});
