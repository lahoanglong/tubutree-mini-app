import type { HttpClient } from '../http';
import { getPendingRefillReturns, getRefillSummary } from '../api/refill';

export const refillQuery = (http: HttpClient) => ({ queryKey: ['refill'] as const, queryFn: () => getRefillSummary(http) });
export const adminRefillPendingQuery = (http: HttpClient) => ({
  queryKey: ['admin-refill-pending'] as const,
  queryFn: () => getPendingRefillReturns(http),
});
