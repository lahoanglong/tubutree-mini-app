import type { HttpClient } from '../http';

/** Khoá trùng `OrdersTabKey` của hai app: số đơn của từng tab trang Đơn hàng. */
export type OrderStatusKey = 'pending_payment' | 'processing' | 'shipping' | 'delivered' | 'closed';
export type OrderStatusCounts = Record<OrderStatusKey, number>;

/** Dưới tiền tố ['orders'] để invalidateQueries({ queryKey: ['orders'] }) sau đặt/huỷ đơn vẫn làm mới số đếm. */
export const ORDER_STATUS_COUNTS_KEY = ['orders', 'status-counts'] as const;

/** Số đơn của khách theo từng tab trong một lời gọi (thay cho mỗi tab một GET /orders?limit=1). */
export const getOrderStatusCounts = (http: HttpClient) => http.get<OrderStatusCounts>('/orders/status-counts');

export const orderStatusCountsQuery = (http: HttpClient) => ({
  queryKey: ORDER_STATUS_COUNTS_KEY,
  queryFn: () => getOrderStatusCounts(http),
});
