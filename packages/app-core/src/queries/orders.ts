import type { HttpClient } from '../http';
import {
  estimateReturn,
  fetchActiveOrderCount,
  fetchMyRefunds,
  fetchMyReturns,
  fetchOrder,
  fetchOrders,
  fetchPurchasedItems,
  fetchRefundBank,
  type OrderListFilter,
  type ReturnReasonCode,
} from '../api/orders';

export const orderQuery = (http: HttpClient, code: string) => ({
  queryKey: ['order', code] as const,
  queryFn: () => fetchOrder(http, code),
});
/** Khoá bắt đầu bằng ['orders'] để invalidateQueries({ queryKey: ['orders'] }) làm mới cả danh sách. `tab` là khoá tab trạng thái. Dùng với useInfiniteQuery (initialPageParam 1): trang lấy từ pageParam, không nằm trong khoá. */
export const ordersListQuery = (http: HttpClient, tab: string, filter: OrderListFilter, limit = 20) => ({
  queryKey: ['orders', 'list', tab] as const,
  queryFn: ({ pageParam }: { pageParam: number }) => fetchOrders(http, filter, pageParam, limit),
});
export const ordersHomeStripQuery = (http: HttpClient) => ({
  queryKey: ['orders', 'home-strip'] as const,
  queryFn: () => fetchOrders(http, { status: 'SHIPPING' }, 1, 1),
});
export const activeOrderCountQuery = (http: HttpClient) => ({
  queryKey: ['orders', 'active-count'] as const,
  queryFn: () => fetchActiveOrderCount(http),
});
export const purchasedItemsQuery = (http: HttpClient, limit: number) => ({
  queryKey: ['purchased-items', limit] as const,
  queryFn: () => fetchPurchasedItems(http, { limit }),
});
export const myReturnsQuery = (http: HttpClient) => ({ queryKey: ['my-returns'] as const, queryFn: () => fetchMyReturns(http) });
export const myRefundsQuery = (http: HttpClient, orderId: string) => ({
  queryKey: ['my-refunds', orderId] as const,
  queryFn: () => fetchMyRefunds(http, orderId),
});
export const refundBankQuery = (http: HttpClient) => ({ queryKey: ['refund-bank'] as const, queryFn: () => fetchRefundBank(http) });
export const returnEstimateQuery = (
  http: HttpClient,
  code: string,
  picked: { orderItemId: string; quantity: number }[],
  reasonCode: ReturnReasonCode | null,
) => ({
  queryKey: ['return-estimate', code, picked, reasonCode] as const,
  queryFn: () => estimateReturn(http, code, { items: picked, reasonCode: reasonCode ?? undefined }),
});
