import { vi } from '../../i18n/vi';
import type { OrderListFilter } from '../../services/shop-api';

export type OrdersTabKey = 'all' | 'pending_payment' | 'processing' | 'shipping' | 'delivered' | 'closed' | 'subscriptions';

export interface OrdersTab {
  key: OrdersTabKey;
  label: string;
  /** Không có filter = tab không phải danh sách đơn (Định kỳ). */
  filter?: OrderListFilter;
}

/** Tab trang Đơn hàng (spec 4a.2 + Ruling 1). "Đang xử lý" gồm Đang đóng gói, "Đã hủy/hoàn" gồm
 * Đã hoàn — hai trạng thái trước đây chỉ thấy ở "Tất cả" (A2-47). */
export const ORDERS_TABS: readonly OrdersTab[] = [
  { key: 'all', label: vi.orders.tabAll, filter: {} },
  { key: 'pending_payment', label: vi.orderStatus.PENDING_PAYMENT!, filter: { status: 'PENDING_PAYMENT' } },
  { key: 'processing', label: vi.orders.tabProcessing, filter: { group: 'processing' } },
  { key: 'shipping', label: vi.orders.tabShipping, filter: { status: 'SHIPPING' } },
  { key: 'delivered', label: vi.orders.tabDelivered, filter: { status: 'DELIVERED' } },
  { key: 'closed', label: vi.orders.tabClosed, filter: { group: 'closed' } },
  { key: 'subscriptions', label: vi.orders.tabSubscriptions },
];

export function parseOrdersTab(search: string): OrdersTabKey {
  const v = new URLSearchParams(search).get('tab');
  return ORDERS_TABS.some((t) => t.key === v) ? (v as OrdersTabKey) : 'all';
}
