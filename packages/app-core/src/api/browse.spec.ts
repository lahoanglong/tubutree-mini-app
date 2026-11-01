import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '../http';
import { fetchBestSellers, fetchBestSellersPage } from './browse';

const card = (id: string) => ({ id, slug: id, brand: 'Tubu', name: id, thumbnail: null, basePrice: 1, salePrice: null, isFeatured: false, inStock: true });
const page = (ids: string[]) => ({ data: ids.map(card), meta: { page: 1, limit: 10, total: ids.length } });
const clientOf = (get: (path: string, opts?: { query?: Record<string, string | number> }) => Promise<unknown>) => ({ get }) as unknown as HttpClient;

describe('fetchBestSellers', () => {
  it('xin 10 món theo bán chạy 30 ngày', async () => {
    const get = vi.fn().mockResolvedValue(page(['a', 'b']));
    const out = await fetchBestSellers(clientOf(get));
    expect(get).toHaveBeenCalledWith('/products', { query: { sort: 'best_seller_30d', limit: 10 } });
    expect(out.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('API cũ chưa biết best_seller_30d (400): lùi về best_seller', async () => {
    const get = vi.fn().mockRejectedValueOnce({ status: 400 }).mockResolvedValueOnce(page(['x']));
    const out = await fetchBestSellers(clientOf(get), 6);
    expect(get).toHaveBeenNthCalledWith(2, '/products', { query: { sort: 'best_seller', limit: 6 } });
    expect(out.map((p) => p.id)).toEqual(['x']);
  });

  it('lỗi khác 400 ném tiếp, không gọi lại', async () => {
    const get = vi.fn().mockRejectedValue({ status: 500 });
    await expect(fetchBestSellers(clientOf(get))).rejects.toEqual({ status: 500 });
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('fetchBestSellersPage', () => {
  const pageOf = (ids: string[], p = 2) => ({ data: ids.map(card), meta: { page: p, limit: 20, total: 45 } });

  it('xin 20 món theo bán chạy 30 ngày kèm trang và danh mục, trả nguyên phân trang', async () => {
    const get = vi.fn().mockResolvedValue(pageOf(['a', 'b']));
    const out = await fetchBestSellersPage(clientOf(get), { page: 2, category: 'c1' });
    expect(get).toHaveBeenCalledWith('/products', { query: { sort: 'best_seller_30d', limit: 20, page: 2, category: 'c1' } });
    expect(out.meta).toEqual({ page: 2, limit: 20, total: 45 });
    expect(out.data.map((p) => p.id)).toEqual(['a', 'b']);
    expect(out.basis).toBe('days30');
  });

  it('không gửi category khi thiếu; limit đổi được', async () => {
    const get = vi.fn().mockResolvedValue(pageOf(['a'], 1));
    await fetchBestSellersPage(clientOf(get), { page: 1, limit: 6 });
    expect(get).toHaveBeenCalledWith('/products', { query: { sort: 'best_seller_30d', limit: 6, page: 1 } });
  });

  it('API cũ chưa biết best_seller_30d (400): lùi về best_seller, giữ trang và danh mục', async () => {
    const get = vi.fn().mockRejectedValueOnce({ status: 400 }).mockResolvedValueOnce(pageOf(['x'], 1));
    const out = await fetchBestSellersPage(clientOf(get), { page: 1, category: 'c1' });
    expect(get).toHaveBeenNthCalledWith(2, '/products', { query: { sort: 'best_seller', limit: 20, page: 1, category: 'c1' } });
    expect(out.data.map((p) => p.id)).toEqual(['x']);
    // Thước đo đổi thành tổng lượt bán: trang phải nói đúng thước đo, không còn "30 ngày qua".
    expect(out.basis).toBe('total');
  });

  it('lỗi khác 400 ném tiếp, không gọi lại', async () => {
    const get = vi.fn().mockRejectedValue({ status: 500 });
    await expect(fetchBestSellersPage(clientOf(get), { page: 1 })).rejects.toEqual({ status: 500 });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
