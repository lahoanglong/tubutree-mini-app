// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ get: vi.fn(), phase: 'authenticated', hydrated: true }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/use-hydrated', () => ({ useHydrated: () => mocks.hydrated }));

import { HOME_BEST_SELLER_LIMIT, type HomeKindState } from '@tubutree/app-core/home-layout';
import { resetFlashSales } from '@/lib/use-flash-sales';
import { useHomeShelves, type HomeShelves } from './use-home-shelves';

const HOUR = 3_600_000;
const flashEnding = (slug: string, i: number, endAt: string) => ({
  itemId: `f${i}`, variationId: `v${i}`, productSlug: slug, productName: slug, thumbnail: null,
  retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 1, endAt,
});
const flashItem = (slug: string, i: number) => flashEnding(slug, i, new Date(Date.now() + HOUR).toISOString());
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
  mocks.hydrated = true;
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
  vi.useRealTimers();
});

describe('useHomeShelves (web)', () => {
  it('Bán chạy nhất xin sort=best_seller_30d, HOME_BEST_SELLER_LIMIT món', async () => {
    await mount('new');
    const call = mocks.get.mock.calls.find(([p]) => String(p).startsWith('/products'));
    expect(call).toBeTruthy();
    expect(JSON.stringify(call)).toContain('best_seller_30d');
    expect(call![1]).toMatchObject({ query: { limit: HOME_BEST_SELLER_LIMIT, sort: 'best_seller_30d' } });
  });

  it('bestSellerBasis là days30 khi API trả theo 30 ngày', async () => {
    const s = await mount('new');
    expect(s.bestSellerBasis).toBe('days30');
  });

  it('API cũ từ chối best_seller_30d (400): kệ lùi về best_seller, vẫn có món và bestSellerBasis là total', async () => {
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string, opts?: { query?: { sort?: string } }) => {
      if (path.startsWith('/products') && opts?.query?.sort === 'best_seller_30d') throw Object.assign(new Error('bad'), { status: 400 });
      return base(path, opts);
    });
    const s = await mount('new');
    expect(s.bestSellers.length).toBeGreaterThan(0);
    expect(mocks.get.mock.calls.some(([, o]) => (o as { query?: { sort?: string } } | undefined)?.query?.sort === 'best_seller')).toBe(true);
    expect(s.bestSellerBasis).toBe('total');
  });

  it('Giờ vàng một thẻ mỗi sản phẩm; Bán chạy bỏ món đã ở Giờ vàng; seen gồm mọi món đang hiện', async () => {
    const s = await mount('new');
    expect(s.flash.map((f) => f.productSlug)).toEqual(['a', 'b', 'c']);
    expect(s.bestSellers.map((p) => p.slug)).toEqual(['x', 'y', 'z', 'w']);
    // Chỉ phân loại của suất đang hiện (v0 của "a", không phải v2 của suất "a" thứ hai bị gộp).
    expect(Array.from(s.flashVariationIds).sort()).toEqual(['v0', 'v1', 'v3']);
    expect(s.seen.has('a') && s.seen.has('x')).toBe(true);
  });

  it('Mua lại chống trùng theo phân loại: món đã mua "b" ở phân loại khác (pv-b) không nằm trong flashVariationIds, sản phẩm vẫn bị chiếm slug nên Bán chạy bỏ nó (P2 #3)', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/flash-sales/active') return ['a', 'b', 'c'].map(flashItem);
      if (path.startsWith('/products')) return { data: ['b', 'x', 'y', 'z'].map(card), meta: { page: 1, limit: 12, total: 4 } };
      if (path.includes('purchased')) return { items: [purchased('b')], meta: { page: 1, limit: 10, total: 1 } };
      return [];
    });
    const s = await mount('returning');
    expect(s.flashVariationIds.has('pv-b')).toBe(false);
    expect(s.flashVariationIds.has('v1')).toBe(true);
    expect(s.bestSellers.map((p) => p.slug)).toEqual(['x', 'y', 'z']);
    expect(s.seen.has('b')).toBe(true);
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

  it('hạng thật của Bán chạy nhất: a (#1) ở Giờ vàng thì các thẻ còn lại ghi #2..#5, không đánh lại từ #1', async () => {
    const s = await mount('new');
    expect(s.bestSellers.map((p) => p.slug)).toEqual(['x', 'y', 'z', 'w']);
    expect(s.bestSellerRanks).toEqual([2, 3, 4, 5]);
  });

  it('hạng thật khi món bị bỏ nằm giữa bảng: Mua lại bỏ "y", thẻ sau nó giữ hạng cũ', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/flash-sales/active') return [];
      if (path.startsWith('/products')) return { data: ['x', 'y', 'z', 'w', 'v'].map(card), meta: { page: 1, limit: 12, total: 5 } };
      if (path.includes('purchased')) return { items: ['y'].map(purchased), meta: { page: 1, limit: 10, total: 1 } };
      return [];
    });
    const s = await mount('returning');
    expect(s.bestSellers.map((p) => p.slug)).toEqual(['x', 'z', 'w', 'v']);
    expect(s.bestSellerRanks).toEqual([1, 3, 4, 5]);
  });

  it('suất đã quá giờ không chiếm món: 3 suất trong bộ nhớ, 1 đã hết giờ thì kệ ẩn và KHÔNG giữ món (cả ba còn ở Bán chạy nhất)', async () => {
    const gone = new Date(Date.now() - 1000).toISOString();
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/flash-sales/active') return [flashItem('a', 0), flashItem('b', 1), flashEnding('c', 2, gone)];
      if (path.startsWith('/products')) return { data: ['a', 'b', 'c', 'x'].map(card), meta: { page: 1, limit: 12, total: 4 } };
      return [];
    });
    const s = await mount('new');
    expect(s.flash).toEqual([]);
    expect(s.flashVariationIds.size).toBe(0);
    expect(s.bestSellers.map((p) => p.slug)).toEqual(['a', 'b', 'c', 'x']);
    expect(s.bestSellerRanks).toEqual([1, 2, 3, 4]);
  });

  it('suất hết giờ giữa chừng: onFlashEnd tính lại, món hết giờ rời Giờ vàng và trở lại Bán chạy nhất với hạng đúng', async () => {
    const NOW = Date.parse('2026-11-01T03:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/flash-sales/active') return [flashItem('a', 0), flashItem('b', 1), flashItem('c', 2), flashEnding('d', 3, new Date(NOW + 60_000).toISOString())];
      if (path.startsWith('/products')) return { data: ['d', 'x', 'y', 'z'].map(card), meta: { page: 1, limit: 12, total: 4 } };
      return [];
    });
    const first = await mount('new');
    expect(first.flash.map((f) => f.productSlug)).toEqual(['a', 'b', 'c', 'd']);
    expect(first.bestSellerRanks).toEqual([2, 3, 4]);

    vi.setSystemTime(NOW + 61_000);
    act(() => latest!.onFlashEnd());
    expect(latest!.flash.map((f) => f.productSlug)).toEqual(['a', 'b', 'c']);
    expect(latest!.bestSellers.map((p) => p.slug)).toEqual(['d', 'x', 'y', 'z']);
    expect(latest!.bestSellerRanks).toEqual([1, 2, 3, 4]);
  });

  describe('kệ combo', () => {
    const comboDto = (id: string, a: string, b: string, endAt = new Date(Date.now() + HOUR).toISOString()) => ({
      id, kind: 'BUNDLE_PCT', title: `Combo ${id}`, pct: 10, endAt, anchorProductId: null,
      items: [a, b].map((slug) => ({ productId: `p-${slug}`, variationId: `rv-${slug}`, maxQty: 1, addonPrice: null, inStock: true, product: card(slug) })),
    });
    const withCombos = (combos: unknown[]) =>
      mocks.get.mockImplementation(async (path: string) => {
        if (path === '/flash-sales/active') return [];
        if (path === '/bundles/combos') return combos;
        if (path.startsWith('/products')) return { data: ['x', 'y', 'z', 'w'].map(card), meta: { page: 1, limit: 12, total: 4 } };
        return [];
      });

    it('hỏi /bundles/combos với limit 4, ẩn danh (cùng request mà khối gộp /home thay thế)', async () => {
      withCombos([]);
      await mount('new');
      expect(mocks.get).toHaveBeenCalledWith('/bundles/combos', { query: { limit: 4 }, anonymous: true });
    });

    const SIX = ['x', 'y', 'z', 'w', 'v', 'u'];
    const sixProducts = { data: SIX.map(card), meta: { page: 1, limit: 12, total: 6 } };
    const withCombosAndSix = (combos: unknown[]) =>
      mocks.get.mockImplementation(async (path: string) => {
        if (path === '/flash-sales/active') return [];
        if (path === '/bundles/combos') return combos;
        if (path.startsWith('/products')) return sixProducts;
        return [];
      });

    it('từ 2 combo còn hạn trở lên thì có kệ; combo chiếm món của mình: Bán chạy nhất bỏ x, y, z, hạng thật giữ nguyên, `seen` có cả ba', async () => {
      withCombosAndSix([comboDto('c1', 'x', 'y'), comboDto('c2', 'x', 'z')]);
      const s = await mount('new');
      expect(s.combos.map((v) => v.id)).toEqual(['c1', 'c2']);
      expect(s.bestSellers.map((p) => p.slug)).toEqual(['w', 'v', 'u']);
      expect(s.bestSellerRanks).toEqual([4, 5, 6]);
      expect([...s.seen].filter((k) => SIX.includes(k)).sort()).toEqual(['u', 'v', 'w', 'x', 'y', 'z']);
    });

    it('combo chiếm món làm Bán chạy nhất dưới 3 món thì kệ ấy ẩn (không để khung rỗng)', async () => {
      withCombos([comboDto('c1', 'x', 'y'), comboDto('c2', 'x', 'z')]);
      const s = await mount('new');
      expect(s.combos).toHaveLength(2);
      expect(s.bestSellers).toEqual([]);
    });

    it('combo chứa món đang ở Giờ vàng vẫn hiện (không bị Giờ vàng loại) và vẫn chiếm món của Bán chạy nhất; Giờ vàng giữ a', async () => {
      mocks.get.mockImplementation(async (path: string) => {
        if (path === '/flash-sales/active') return ['a', 'b', 'c'].map(flashItem);
        if (path === '/bundles/combos') return [comboDto('c1', 'a', 'y'), comboDto('c2', 'a', 'z')];
        if (path.startsWith('/products')) return sixProducts;
        return [];
      });
      const s = await mount('new');
      expect(s.flash.map((f) => f.productSlug)).toEqual(['a', 'b', 'c']);
      expect(s.combos.map((v) => v.id)).toEqual(['c1', 'c2']);
      expect(s.bestSellers.map((p) => p.slug)).toEqual(['x', 'w', 'v', 'u']);
    });

    it('Mua lại về sau HTML đầu và giữ chính món của combo (x): kệ combo không biến mất ở lần vẽ nào, Bán chạy nhất không đổi', async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      mocks.get.mockImplementation(async (path: string) => {
        if (path === '/flash-sales/active') return [];
        if (path.includes('purchased')) {
          await held;
          return { items: ['x'].map(purchased), meta: { page: 1, limit: 10, total: 1 } };
        }
        return [];
      });
      const renders: { combos: number; best: string }[] = [];
      function Initial() {
        latest = useHomeShelves('returning', { combos: [comboDto('c1', 'x', 'y'), comboDto('c2', 'x', 'z')] as never, bestSellers: sixProducts });
        renders.push({ combos: latest.combos.length, best: latest.bestSellers.map((p) => p.slug).join() });
        return null;
      }
      mounted = render(<Initial />);
      await flush(8);
      expect(renders.at(-1)).toEqual({ combos: 2, best: 'w,v,u' });
      const beforeRelease = renders.length;
      act(() => release());
      await flush(8);
      expect(renders.length).toBeGreaterThan(beforeRelease);
      expect(renders.every((r) => r.combos === 2 && r.best === 'w,v,u')).toBe(true);
    });

    it('combo dựng sẵn ở máy chủ có ngay ở lần vẽ đầu: kệ combo và Bán chạy nhất đã bỏ món trùng trong HTML đầu, không hỏi lại /bundles/combos', async () => {
      function Initial() {
        latest = useHomeShelves('new', { combos: [comboDto('c1', 'x', 'y'), comboDto('c2', 'x', 'z')] as never, bestSellers: sixProducts });
        return null;
      }
      mounted = render(<Initial />);
      expect(latest!.combos.map((v) => v.id)).toEqual(['c1', 'c2']);
      expect(latest!.bestSellers.map((p) => p.slug)).toEqual(['w', 'v', 'u']);
      await flush(8);
      expect(mocks.get).not.toHaveBeenCalledWith('/bundles/combos', expect.anything());
    });

    it('HTML ISR cũ hơn hạn tươi (combosAt quá 60 giây): hydrate hỏi lại ngay, combo đã tắt rời kệ và món của nó trở về Bán chạy nhất; còn tươi thì không hỏi', async () => {
      withCombosAndSix([]);
      function Initial({ combosAt }: { combosAt: number }) {
        latest = useHomeShelves('new', { combos: [comboDto('c1', 'x', 'y'), comboDto('c2', 'x', 'z')] as never, combosAt, bestSellers: sixProducts });
        return null;
      }
      mounted = render(<Initial combosAt={Date.now() - 2 * 60_000} />);
      expect(latest!.combos).toHaveLength(2);
      await flush(8);
      expect(mocks.get).toHaveBeenCalledWith('/bundles/combos', expect.anything());
      expect(latest!.combos).toEqual([]);
      expect(latest!.bestSellers.map((p) => p.slug)).toEqual(SIX);

      mounted.unmount();
      mocks.get.mockClear();
      mounted = render(<Initial combosAt={Date.now() - 5_000} />);
      await flush(8);
      expect(mocks.get).not.toHaveBeenCalledWith('/bundles/combos', expect.anything());
    });

    it('lượt hydrate đầu vẫn vẽ combo mà HTML dựng sẵn đã vẽ dù vừa quá hạn; sau hydrate combo ấy mới bị bỏ và thôi chiếm món', async () => {
      const gone = new Date(Date.now() - 1000).toISOString();
      mocks.hydrated = false;
      function Initial() {
        latest = useHomeShelves('new', { combos: [comboDto('c1', 'x', 'y'), comboDto('c2', 'x', 'z', gone)] as never, bestSellers: sixProducts });
        return null;
      }
      mounted = render(<Initial />);
      expect(latest!.combos.map((v) => v.id)).toEqual(['c1', 'c2']);
      expect(latest!.bestSellers.map((p) => p.slug)).toEqual(['w', 'v', 'u']);

      mocks.hydrated = true;
      act(() => latest!.onFlashEnd());
      expect(latest!.combos).toEqual([]);
      expect(latest!.bestSellers.map((p) => p.slug)).toEqual(SIX);
    });

    it('dưới 2 combo hoặc combo đã hết hạn theo giờ máy chủ: kệ rỗng', async () => {
      withCombos([comboDto('c1', 'x', 'y')]);
      expect((await mount('new')).combos).toEqual([]);
      mounted!.unmount();
      resetFlashSales();
      latest = null;
      withCombos([comboDto('c1', 'x', 'y'), comboDto('c2', 'x', 'z', new Date(Date.now() - 1000).toISOString())]);
      expect((await mount('new')).combos).toEqual([]);
    });

    it('API combo lỗi: kệ rỗng, các kệ khác vẫn có', async () => {
      mocks.get.mockImplementation(async (path: string) => {
        if (path === '/bundles/combos') throw new Error('offline');
        if (path === '/flash-sales/active') return [];
        if (path.startsWith('/products')) return { data: ['x', 'y', 'z'].map(card), meta: { page: 1, limit: 12, total: 3 } };
        return [];
      });
      const s = await mount('new');
      expect(s.combos).toEqual([]);
      expect(s.bestSellers).toHaveLength(3);
    });
  });
});
