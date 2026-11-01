import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchFlash: vi.fn(), fetchPurchased: vi.fn(), fetchProducts: vi.fn(), fetchCombos: vi.fn(), status: 'authenticated' }));
vi.mock('../../services/shop-api', () => ({
  fetchActiveFlashSales: mocks.fetchFlash,
  fetchPurchasedItems: mocks.fetchPurchased,
  fetchProducts: mocks.fetchProducts,
}));
vi.mock('../../services/bundle-api', () => ({ getHomeCombos: mocks.fetchCombos }));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));

import { COMBO_HOLD_MS } from '@tubutree/app-core/merch/home-shelves';
import { useHomeShelves } from './use-home-shelves';

const flashEnding = (slug: string, endAt: string) => ({ itemId: `i-${slug}`, variationId: 'v', productSlug: slug, productName: slug, thumbnail: null, flashPrice: 1, retailPrice: 2, soldCount: 0, quota: 5, endAt });
const flash = (slug: string) => flashEnding(slug, '2099-01-01T00:00:00.000Z');
const bought = (slug: string) => ({ variationId: `v-${slug}`, productId: slug, slug, productName: slug, variationName: null, brand: '', thumbnail: null, price: 1, salePrice: null, stock: 3, inStock: true, timesBought: 1, retailOnly: false, lastPurchasedAt: '2026-01-01' });
const card = (slug: string) => ({ id: `id-${slug}`, slug, brand: '', name: slug, thumbnail: null, basePrice: 1, salePrice: null, isFeatured: false, inStock: true });
const page = (slugs: string[]) => ({ data: slugs.map(card), meta: { page: 1, limit: 12, total: slugs.length } });
const slugsOf = (xs: { slug: string }[]) => xs.map((x) => x.slug);

function setup(kind: 'returning' | 'new' | 'unknown') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useHomeShelves(kind), { wrapper });
}

const bundleOf = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'BUNDLE_PCT', title: `Combo ${id}`, pct: 10, endAt: '2099-01-01T00:00:00.000Z', anchorProductId: null,
  items: ['a', 'b'].map((n) => ({ productId: `${id}${n}`, variationId: `v-${id}${n}`, maxQty: 1, addonPrice: null, inStock: true, product: card(`p1`) })),
  ...over,
});

describe('useHomeShelves — chống trùng bốn kệ hàng của Trang chủ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
    mocks.fetchFlash.mockResolvedValue(['a', 'b', 'c'].map(flash));
    mocks.fetchPurchased.mockResolvedValue({ items: [bought('b'), bought('x')], nextCursor: null });
    mocks.fetchProducts.mockResolvedValue(page(['a', 'x', 'p1', 'p2', 'p3', 'p4']));
    mocks.fetchCombos.mockResolvedValue([]);
  });

  it('Bán chạy nhất lấy 12 món theo 30 ngày; bỏ món đã ở Giờ vàng (a) và Mua lại (x)', async () => {
    const { result } = setup('returning');
    await waitFor(() => expect(slugsOf(result.current.bestSellers)).toEqual(['p1', 'p2', 'p3', 'p4']));
    expect(mocks.fetchProducts).toHaveBeenCalledWith({ limit: 12, sort: 'best_seller_30d' });
    expect([...result.current.seen].sort()).toEqual(['a', 'b', 'c', 'p1', 'p2', 'p3', 'p4', 'x']);
  });

  it('Giờ vàng giữ món trùng: Mua lại bỏ "b" (flashSlugs) còn "x"', async () => {
    const { result } = setup('returning');
    await waitFor(() => expect(result.current.flash).toHaveLength(3));
    expect([...result.current.flashSlugs].sort()).toEqual(['a', 'b', 'c']);
  });

  it('khách mới: kệ Mua lại không chiếm món nào dù API có trả', async () => {
    const { result } = setup('new');
    await waitFor(() => expect(slugsOf(result.current.bestSellers)).toEqual(['x', 'p1', 'p2', 'p3', 'p4']));
    expect(result.current.seen.has('x')).toBe(true);
    expect([...result.current.seen].includes('b')).toBe(true);
  });

  it('kệ dưới mức tối thiểu bị ẩn và KHÔNG chiếm món: Giờ vàng 2 món, Bán chạy còn 2 sau khi bỏ trùng', async () => {
    mocks.fetchFlash.mockResolvedValue(['a', 'b'].map(flash));
    mocks.fetchProducts.mockResolvedValue(page(['a', 'x', 'p1']));
    const { result } = setup('returning');
    await waitFor(() => expect(result.current.bestSellerQuery.isLoading).toBe(false));
    await waitFor(() => expect(result.current.flashQuery.isLoading).toBe(false));
    expect(result.current.flash).toEqual([]);
    expect(result.current.flashSlugs.size).toBe(0);
    // Giờ vàng ẩn nên không chiếm "a": Bán chạy chỉ bỏ "x" của Mua lại, còn a + p1 = 2 món < 3 thì ẩn.
    expect(result.current.bestSellers).toEqual([]);
    expect(result.current.seen.has('p1')).toBe(false);
  });

  it('trạng thái tải và lỗi của hai nguồn lộ ra để khối dựng khung chờ/thử lại', async () => {
    mocks.fetchFlash.mockRejectedValue(new Error('x'));
    mocks.fetchProducts.mockReturnValue(new Promise(() => {}));
    const { result } = setup('returning');
    expect(result.current.bestSellerQuery.isLoading).toBe(true);
    await waitFor(() => expect(result.current.flashQuery.isError).toBe(true));
    expect(result.current.flash).toEqual([]);
  });

  it('hạng thật của Bán chạy nhất: a (#1) ở Giờ vàng, x (#2) ở Mua lại thì các thẻ còn lại ghi #3..#6, không đánh lại từ #1', async () => {
    const { result } = setup('returning');
    await waitFor(() => expect(slugsOf(result.current.bestSellers)).toEqual(['p1', 'p2', 'p3', 'p4']));
    expect(result.current.bestSellerRanks).toEqual([3, 4, 5, 6]);
  });

  it('hạng thật khi món bị bỏ nằm giữa bảng: kệ bỏ "b", thẻ sau nó giữ hạng cũ (#1, #3, #4)', async () => {
    mocks.fetchProducts.mockResolvedValue(page(['p1', 'b', 'p2', 'p3', 'p4']));
    const { result } = setup('new');
    await waitFor(() => expect(slugsOf(result.current.bestSellers)).toEqual(['p1', 'p2', 'p3', 'p4']));
    expect(result.current.bestSellerRanks).toEqual([1, 3, 4, 5]);
  });

  it('bestSellerBasis là days30 khi API trả theo 30 ngày', async () => {
    const { result } = setup('returning');
    await waitFor(() => expect(result.current.bestSellers.length).toBeGreaterThan(0));
    expect(result.current.bestSellerBasis).toBe('days30');
  });

  it('API cũ từ chối best_seller_30d (400): kệ lùi về best_seller, vẫn có món và bestSellerBasis là total', async () => {
    mocks.fetchProducts.mockImplementation(async (params: { sort?: string }) => {
      if (params.sort === 'best_seller_30d') throw { response: { status: 400 } };
      return page(['p1', 'p2', 'p3', 'p4']);
    });
    const { result } = setup('new');
    await waitFor(() => expect(slugsOf(result.current.bestSellers)).toEqual(['p1', 'p2', 'p3', 'p4']));
    expect(mocks.fetchProducts).toHaveBeenCalledWith({ limit: 12, sort: 'best_seller' });
    expect(result.current.bestSellerBasis).toBe('total');
  });

  it('không có món nào bị bỏ thì hạng là #1..#n', async () => {
    mocks.fetchFlash.mockResolvedValue([]);
    mocks.fetchProducts.mockResolvedValue(page(['p1', 'p2', 'p3', 'p4']));
    const { result } = setup('new');
    await waitFor(() => expect(slugsOf(result.current.bestSellers)).toHaveLength(4));
    expect(result.current.bestSellerRanks).toEqual([1, 2, 3, 4]);
  });

  describe('suất Giờ vàng đã quá giờ không chiếm món', () => {
    const NOW = Date.parse('2026-11-01T03:00:00.000Z');
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(NOW));
    afterEach(() => vi.useRealTimers());

    it('3 suất trong bộ nhớ, 1 đã quá giờ: còn 2 suất sống nên kệ ẩn và KHÔNG giữ món; cả ba món vẫn hiện ở Bán chạy nhất', async () => {
      const gone = new Date(NOW - 1000).toISOString();
      mocks.fetchFlash.mockResolvedValue([flash('a'), flash('b'), flashEnding('c', gone)]);
      mocks.fetchProducts.mockResolvedValue(page(['a', 'b', 'c', 'p1']));
      const { result } = setup('new');
      await waitFor(() => expect(result.current.bestSellerQuery.isLoading).toBe(false));
      await waitFor(() => expect(result.current.flashQuery.isLoading).toBe(false));
      expect(result.current.flash).toEqual([]);
      expect(result.current.flashSlugs.size).toBe(0);
      expect(slugsOf(result.current.bestSellers)).toEqual(['a', 'b', 'c', 'p1']);
      expect([...result.current.seen].sort()).toEqual(['a', 'b', 'c', 'p1']);
    });

    it('suất hết giờ giữa chừng: onFlashEnd tính lại, món hết giờ rời Giờ vàng và trở lại Bán chạy nhất với hạng đúng', async () => {
      mocks.fetchFlash.mockResolvedValue([flash('a'), flash('b'), flash('c'), flashEnding('d', new Date(NOW + 60_000).toISOString())]);
      mocks.fetchProducts.mockResolvedValue(page(['d', 'p1', 'p2', 'p3']));
      const { result } = setup('new');
      await waitFor(() => expect(result.current.flash).toHaveLength(4));
      expect(slugsOf(result.current.bestSellers)).toEqual(['p1', 'p2', 'p3']);
      expect(result.current.bestSellerRanks).toEqual([2, 3, 4]);

      vi.setSystemTime(NOW + 61_000);
      act(() => result.current.onFlashEnd());
      expect(result.current.flash.map((f) => f.productSlug)).toEqual(['a', 'b', 'c']);
      expect(slugsOf(result.current.bestSellers)).toEqual(['d', 'p1', 'p2', 'p3']);
      expect(result.current.bestSellerRanks).toEqual([1, 2, 3, 4]);
      expect(result.current.flashSlugs.has('d')).toBe(false);
    });
  });

  describe('combo toàn sàn', () => {
    it('hai combo đang chạy lên kệ combos và chiếm món của mình: p1 rời Bán chạy nhất (hạng thật các món sau không đổi), `seen` có p1', async () => {
      mocks.fetchCombos.mockResolvedValue([bundleOf('c1'), bundleOf('c2')]);
      const { result } = setup('returning');
      await waitFor(() => expect(result.current.combos.map((v) => v.id)).toEqual(['c1', 'c2']));
      await waitFor(() => expect(slugsOf(result.current.bestSellers)).toEqual(['p2', 'p3', 'p4']));
      expect(result.current.bestSellerRanks).toEqual([4, 5, 6]);
      expect(result.current.seen.has('p1')).toBe(true);
    });

    it('combo chứa món đang ở Giờ vàng thì bị bỏ cả bộ: kệ combos ẩn và không chiếm p1, Bán chạy nhất vẫn hiện p1', async () => {
      mocks.fetchFlash.mockResolvedValue(['a', 'b', 'p1'].map(flash));
      mocks.fetchCombos.mockResolvedValue([bundleOf('c1'), bundleOf('c2')]);
      const { result } = setup('returning');
      await waitFor(() => expect(result.current.flash).toHaveLength(3));
      await waitFor(() => expect(result.current.bestSellerQuery.isLoading).toBe(false));
      expect(result.current.combos).toEqual([]);
      expect(slugsOf(result.current.bestSellers)).toEqual(['p2', 'p3', 'p4']);
    });

    it('một combo thì kệ ẩn (tối thiểu 2) và không chiếm món; combo đã quá hạn không tính', async () => {
      mocks.fetchCombos.mockResolvedValue([bundleOf('c1'), bundleOf('c2', { endAt: '2000-01-01T00:00:00.000Z' })]);
      const { result } = setup('returning');
      await waitFor(() => expect(mocks.fetchCombos).toHaveBeenCalled());
      await waitFor(() => expect(result.current.bestSellerQuery.isLoading).toBe(false));
      expect(result.current.combos).toEqual([]);
      expect(slugsOf(result.current.bestSellers)).toContain('p1');
      expect(result.current.seen.has('c1')).toBe(false);
    });

    it('lỗi tải combo: kệ rỗng, các kệ khác không bị ảnh hưởng và Bán chạy nhất không bị giữ khung chờ', async () => {
      mocks.fetchCombos.mockRejectedValue(new Error('x'));
      const { result } = setup('returning');
      await waitFor(() => expect(slugsOf(result.current.bestSellers)).toEqual(['p1', 'p2', 'p3', 'p4']));
      expect(result.current.combos).toEqual([]);
      expect(result.current.bestSellerQuery.isLoading).toBe(false);
    });

    it('combo về chậm hơn Bán chạy nhất: giữ khung chờ Bán chạy nhất tới khi biết combo, nên p1 không hiện rồi biến mất', async () => {
      let resolveCombos!: (v: unknown[]) => void;
      mocks.fetchCombos.mockReturnValue(new Promise((resolve) => (resolveCombos = resolve)));
      const { result } = setup('returning');
      await waitFor(() => expect(result.current.bestSellerQuery.data).toBeDefined());
      expect(result.current.bestSellerQuery.isLoading).toBe(true);
      act(() => resolveCombos([bundleOf('c1'), bundleOf('c2')]));
      await waitFor(() => expect(result.current.bestSellerQuery.isLoading).toBe(false));
      expect(slugsOf(result.current.bestSellers)).toEqual(['p2', 'p3', 'p4']);
    });

    it('combo không bao giờ về: quá COMBO_HOLD_MS thì Bán chạy nhất vẽ tiếp, không giữ khung chờ mãi', async () => {
      mocks.fetchCombos.mockReturnValue(new Promise(() => {}));
      const { result } = setup('returning');
      await waitFor(() => expect(result.current.bestSellerQuery.data).toBeDefined());
      expect(result.current.bestSellerQuery.isLoading).toBe(true);
      await waitFor(() => expect(result.current.bestSellerQuery.isLoading).toBe(false), { timeout: COMBO_HOLD_MS + 1500 });
      expect(slugsOf(result.current.bestSellers)).toEqual(['p1', 'p2', 'p3', 'p4']);
    });
  });
});
