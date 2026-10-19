import type { HttpClient } from '../http';
import { fetchActiveFlashSales, fetchUpcomingFlashSales } from '../api/flash-sale';

export const flashActiveQuery = (http: HttpClient) => ({
  queryKey: ['flash-sales', 'active'] as const,
  queryFn: () => fetchActiveFlashSales(http),
});
export const flashUpcomingQuery = (http: HttpClient) => ({
  queryKey: ['flash-sales', 'upcoming'] as const,
  queryFn: () => fetchUpcomingFlashSales(http),
});
