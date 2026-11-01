import type { HttpClient } from '../http';
import { errorStatus } from './error-status';
import type { PageResponse, ProductCard } from './catalog';

/**
 * Kệ Bán chạy nhất của hub Danh mục: theo lượt bán 30 ngày (`best_seller_30d`). API trước đợt shop 2026-10 từ chối giá trị này
 * (400, `forbidNonWhitelisted`) nên lùi về `best_seller` (tổng lượt bán) thay vì để kệ trống.
 */
export async function fetchBestSellers(http: HttpClient, limit = 10): Promise<ProductCard[]> {
  return (await bestSellersWithBasis((sort) => http.get<PageResponse<ProductCard>>('/products', { query: { sort, limit } }))).data;
}

/** Thước đo của một trang Bán chạy nhất: 30 ngày gần đây (`best_seller_30d`) hay tổng lượt bán (`best_seller`, khi API cũ từ chối thước đo mới). */
export type BestSellersBasis = 'days30' | 'total';

export interface BestSellersPage extends PageResponse<ProductCard> {
  /** Thiếu ở dữ liệu cũ (cache, trang dựng sẵn từ trước) thì coi như `days30`. */
  basis?: BestSellersBasis;
}

/**
 * Chạy `load('best_seller_30d')`; API cũ từ chối thước đo đó (400, `forbidNonWhitelisted`) thì lùi về `load('best_seller')` để kệ không trống, và ghi `basis`
 * để nơi vẽ nói đúng thước đo ("30 ngày qua" sai trên bảng xếp theo tổng lượt bán). Lỗi khác 400 ném tiếp. Dùng chung cho trang Bán chạy nhất và kệ Trang chủ
 * (mỗi nơi tự cấp cách gọi: web đi qua `HttpClient`, Mini App qua `fetchProducts` có đường tắt khối `/home`).
 */
export async function bestSellersWithBasis(load: (sort: 'best_seller_30d' | 'best_seller') => Promise<PageResponse<ProductCard>>): Promise<BestSellersPage> {
  try {
    return { ...(await load('best_seller_30d')), basis: 'days30' };
  } catch (err) {
    if (errorStatus(err) !== 400) throw err;
    return { ...(await load('best_seller')), basis: 'total' };
  }
}

/**
 * Một trang của "Bán chạy nhất": 20 món xếp theo lượt bán 30 ngày, tuỳ chọn một danh mục gốc (API gồm cả con). Lùi về `best_seller` khi API
 * cũ từ chối `best_seller_30d` (xem `bestSellersWithBasis`), để trang không trắng. Trả cả `meta` vì trang web phân trang số.
 */
export async function fetchBestSellersPage(
  http: HttpClient,
  { category, page, limit = 20 }: { category?: string; page: number; limit?: number },
): Promise<BestSellersPage> {
  return bestSellersWithBasis((sort) => http.get<PageResponse<ProductCard>>('/products', { query: { sort, limit, page, ...(category ? { category } : {}) } }));
}
