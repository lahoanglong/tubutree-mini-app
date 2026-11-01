import { describe, expect, it, vi } from 'vitest';
import { HOME_BEST_SELLER_LIMIT } from '../home-layout';
import type { HttpClient } from '../http';
import { homeBestSellerQuery } from './home';

const card = (id: string) => ({ id, slug: id, brand: 'Tubu', name: id, thumbnail: null, basePrice: 1, salePrice: null, isFeatured: false, inStock: true });
const page = (ids: string[]) => ({ data: ids.map(card), meta: { page: 1, limit: HOME_BEST_SELLER_LIMIT, total: ids.length } });
const clientOf = (get: (path: string, opts?: { query?: Record<string, string | number> }) => Promise<unknown>) => ({ get }) as unknown as HttpClient;

describe('homeBestSellerQuery', () => {
  it('xin HOME_BEST_SELLER_LIMIT món theo bán chạy 30 ngày, basis days30', async () => {
    const get = vi.fn().mockResolvedValue(page(['a', 'b']));
    const out = (await homeBestSellerQuery(clientOf(get)).queryFn()) as { data: { id: string }[]; basis: string };
    expect(get).toHaveBeenCalledWith('/products', { query: { limit: HOME_BEST_SELLER_LIMIT, sort: 'best_seller_30d' } });
    expect(out.basis).toBe('days30');
    expect(out.data.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('API cũ từ chối best_seller_30d (400): kệ vẫn có món theo tổng lượt bán và nói đúng thước đo (basis total)', async () => {
    const get = vi.fn().mockRejectedValueOnce({ status: 400 }).mockResolvedValueOnce(page(['x']));
    const out = (await homeBestSellerQuery(clientOf(get)).queryFn()) as { data: { id: string }[]; basis: string };
    expect(get).toHaveBeenNthCalledWith(2, '/products', { query: { limit: HOME_BEST_SELLER_LIMIT, sort: 'best_seller' } });
    expect(out.basis).toBe('total');
    expect(out.data.map((p) => p.id)).toEqual(['x']);
  });

  it('lỗi khác 400 vẫn là lỗi khối (không lùi)', async () => {
    const get = vi.fn().mockRejectedValue({ status: 500 });
    await expect(homeBestSellerQuery(clientOf(get)).queryFn()).rejects.toEqual({ status: 500 });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
