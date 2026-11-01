import type { HttpClient } from '../http';
import { fetchBestSellers } from '../api/browse';

export const bestSellersQuery = (http: HttpClient, limit = 10) => ({
  queryKey: ['products', 'best-sellers', limit] as const,
  queryFn: () => fetchBestSellers(http, limit),
});
