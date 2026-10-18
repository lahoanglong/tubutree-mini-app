import type { HttpClient } from '../http';
import { fetchProducts } from '../api/catalog';

// Khớp SECTION_LIMIT của Trang chủ Mini App và HOME_PUBLIC phía API.
const SECTION_LIMIT = 6;
const FEATURED_FETCH_LIMIT = SECTION_LIMIT * 2;

export const homeBestSellerQuery = (http: HttpClient) => ({
  queryKey: ['products', 'home-best-seller'] as const,
  queryFn: () => fetchProducts(http, { limit: SECTION_LIMIT, sort: 'best_seller' }),
});
export const homeFeaturedQuery = (http: HttpClient) => ({
  queryKey: ['products', 'home-featured'] as const,
  queryFn: () => fetchProducts(http, { limit: FEATURED_FETCH_LIMIT }),
});
export const homeNewestQuery = (http: HttpClient) => ({
  queryKey: ['products', 'home-newest'] as const,
  queryFn: () => fetchProducts(http, { limit: SECTION_LIMIT, sort: 'newest' }),
});
