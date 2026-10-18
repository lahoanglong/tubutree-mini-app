import type { HttpClient } from '../http';
import {
  fetchBoughtTogether,
  fetchBrands,
  fetchCatalog,
  fetchCategories,
  fetchForYou,
  fetchProduct,
  fetchProducts,
  fetchProductsBySlugs,
  fetchRelated,
  suggestProducts,
  type CatalogQuery,
} from '../api/catalog';

const SUGGESTED_LIMIT = 4;

export const productQuery = (http: HttpClient, slug: string) => ({
  queryKey: ['product', slug] as const,
  queryFn: () => fetchProduct(http, slug),
});
export const relatedQuery = (http: HttpClient, slug: string) => ({
  queryKey: ['related', slug] as const,
  queryFn: () => fetchRelated(http, slug),
});
export const boughtTogetherQuery = (http: HttpClient, slug: string) => ({
  queryKey: ['bought-together', slug] as const,
  queryFn: () => fetchBoughtTogether(http, slug),
});
export const brandsQuery = (http: HttpClient) => ({ queryKey: ['brands'] as const, queryFn: () => fetchBrands(http) });
export const categoriesQuery = (http: HttpClient) => ({ queryKey: ['categories'] as const, queryFn: () => fetchCategories(http) });
export const forYouQuery = (http: HttpClient) => ({ queryKey: ['for-you'] as const, queryFn: () => fetchForYou(http) });
/** Ô gợi ý tìm kiếm chung; ô chọn sản phẩm của cộng đồng và của CTV dùng khoá riêng (`suggest`, `ctv-suggest`) cùng queryFn này. */
export const suggestQuery = (http: HttpClient, term: string) => ({
  queryKey: ['search-suggest', term] as const,
  queryFn: () => suggestProducts(http, term),
});
export const recentlyViewedQuery = (http: HttpClient, slugs: string[]) => ({
  queryKey: ['recently-viewed-products', slugs.join(',')] as const,
  queryFn: () => fetchProductsBySlugs(http, slugs),
});
/** `countKey` là chuỗi bộ lọc đã debounce; số đếm luôn suy ra từ chính khoá. */
export const catalogCountQuery = (http: HttpClient, countKey: string, query: CatalogQuery) => ({
  queryKey: ['products', 'count', countKey] as const,
  queryFn: () => fetchCatalog(http, query),
});
export const suggestedRailQuery = (http: HttpClient) => ({
  queryKey: ['products', 'suggested-rail'] as const,
  queryFn: () => fetchProducts(http, { limit: SUGGESTED_LIMIT, sort: 'best_seller' }),
});
