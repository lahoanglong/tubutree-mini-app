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

/** Thước đo của một trang Bán chạy nhất: 30 ngày gần đây (`best_seller_30d`) hay tổng lượt bán (`best_seller`, khi API cũ từ chối thước đo mới). */
export type BestSellersBasis = 'days30' | 'total';

export interface BestSellersPage extends PageResponse<ProductCard> {
  /** Thiếu ở dữ liệu cũ (cache, trang dựng sẵn từ trước) thì coi như `days30`. */
  basis?: BestSellersBasis;
}

/**
 * Một trang của "Bán chạy nhất": 20 món xếp theo lượt bán 30 ngày, tuỳ chọn một danh mục gốc (API gồm cả con). Lùi về `best_seller` khi API
 * cũ từ chối `best_seller_30d` (400), như `fetchBestSellers`, để trang không trắng; `basis` cho trang biết đang xếp theo thước đo nào để không ghi
 * "30 ngày qua" trên bảng xếp theo tổng lượt bán. Trả cả `meta` vì trang web phân trang số.
 */
export async function fetchBestSellersPage(
  http: HttpClient,
  { category, page, limit = 20 }: { category?: string; page: number; limit?: number },
): Promise<BestSellersPage> {
  const query = (sort: 'best_seller_30d' | 'best_seller') => ({ sort, limit, page, ...(category ? { category } : {}) });
  try {
    return { ...(await http.get<PageResponse<ProductCard>>('/products', { query: query('best_seller_30d') })), basis: 'days30' };
  } catch (err) {
    if (errorStatus(err) !== 400) throw err;
    return { ...(await http.get<PageResponse<ProductCard>>('/products', { query: query('best_seller') })), basis: 'total' };
  }
}
