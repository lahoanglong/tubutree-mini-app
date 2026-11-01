import type { HttpClient } from '../http';
import type { PageResponse, ProductCard } from '../api/catalog';
import { fetchBestSellers, fetchBestSellersPage } from '../api/browse';

export const bestSellersQuery = (http: HttpClient, limit = 10) => ({
  queryKey: ['products', 'best-sellers', limit] as const,
  queryFn: () => fetchBestSellers(http, limit),
});

/**
 * Trang Bán chạy nhất, dùng với useInfiniteQuery. Khoá bắt đầu bằng `products` để kéo-làm-mới và đổi cache chung cũng làm mới nó;
 * `startPage` nằm trong khoá vì web có thể mở thẳng `?page=N` (danh sách bắt đầu từ N, không dùng lại mục cache bắt đầu từ trang 1).
 */
export const bestSellersListQuery = (http: HttpClient, category: string | undefined, startPage = 1) => ({
  queryKey: ['products', 'best-sellers-list', category ?? 'all', startPage] as const,
  queryFn: ({ pageParam }: { pageParam: number }) => fetchBestSellersPage(http, { category, page: pageParam }),
  initialPageParam: startPage,
  getNextPageParam: (last: PageResponse<ProductCard>) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
});
