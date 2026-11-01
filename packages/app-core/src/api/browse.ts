import type { HttpClient } from '../http';
import { errorStatus } from './error-status';
import type { PageResponse, ProductCard } from './catalog';

/**
 * Kệ Bán chạy nhất của hub Danh mục: theo lượt bán 30 ngày (`best_seller_30d`). API trước đợt shop 2026-10 từ chối giá trị này
 * (400, `forbidNonWhitelisted`) nên lùi về `best_seller` (tổng lượt bán) thay vì để kệ trống.
 */
export async function fetchBestSellers(http: HttpClient, limit = 10): Promise<ProductCard[]> {
  try {
    return (await http.get<PageResponse<ProductCard>>('/products', { query: { sort: 'best_seller_30d', limit } })).data;
  } catch (err) {
    if (errorStatus(err) !== 400) throw err;
    return (await http.get<PageResponse<ProductCard>>('/products', { query: { sort: 'best_seller', limit } })).data;
  }
}

/**
 * Một trang của "Bán chạy nhất": 20 món xếp theo lượt bán 30 ngày, tuỳ chọn một danh mục gốc (API gồm cả con). Lùi về `best_seller` khi API
 * cũ từ chối `best_seller_30d` (400), như `fetchBestSellers`, để trang không trắng. Trả cả `meta` vì trang web phân trang số.
 */
export async function fetchBestSellersPage(
  http: HttpClient,
  { category, page, limit = 20 }: { category?: string; page: number; limit?: number },
): Promise<PageResponse<ProductCard>> {
  const query = (sort: 'best_seller_30d' | 'best_seller') => ({ sort, limit, page, ...(category ? { category } : {}) });
  try {
    return await http.get<PageResponse<ProductCard>>('/products', { query: query('best_seller_30d') });
  } catch (err) {
    if (errorStatus(err) !== 400) throw err;
    return http.get<PageResponse<ProductCard>>('/products', { query: query('best_seller') });
  }
}
