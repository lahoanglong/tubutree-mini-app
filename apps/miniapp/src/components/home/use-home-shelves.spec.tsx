import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchFlash: vi.fn(), fetchPurchased: vi.fn(), fetchProducts: vi.fn(), status: 'authenticated' }));
vi.mock('../../services/shop-api', () => ({
  fetchActiveFlashSales: mocks.fetchFlash,
  fetchPurchasedItems: mocks.fetchPurchased,
  fetchProducts: mocks.fetchProducts,
}));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));

import { useHomeShelves } from './use-home-shelves';

const flash = (slug: string) => ({ itemId: `i-${slug}`, variationId: 'v', productSlug: slug, productName: slug, thumbnail: null, flashPrice: 1, retailPrice: 2, soldCount: 0, quota: 5, endAt: '2099-01-01T00:00:00.000Z' });
const bought = (slug: string) => ({ variationId: `v-${slug}`, productId: slug, slug, productName: slug, variationName: null, brand: '', thumbnail: null, price: 1, salePrice: null, stock: 3, inStock: true, timesBought: 1, retailOnly: false, lastPurchasedAt: '2026-01-01' });
const card = (slug: string) => ({ id: `id-${slug}`, slug, brand: '', name: slug, thumbnail: null, basePrice: 1, salePrice: null, isFeatured: false, inStock: true });
const page = (slugs: string[]) => ({ data: slugs.map(card), meta: { page: 1, limit: 12, total: slugs.length } });
const slugsOf = (xs: { slug: string }[]) => xs.map((x) => x.slug);

function setup(kind: 'returning' | 'new' | 'unknown') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useHomeShelves(kind), { wrapper });
}

describe('useHomeShelves — chống trùng bốn kệ hàng của Trang chủ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
    mocks.fetchFlash.mockResolvedValue(['a', 'b', 'c'].map(flash));
    mocks.fetchPurchased.mockResolvedValue({ items: [bought('b'), bought('x')], nextCursor: null });
    mocks.fetchProducts.mockResolvedValue(page(['a', 'x', 'p1', 'p2', 'p3', 'p4']));
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
});
