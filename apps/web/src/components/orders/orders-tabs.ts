import type { OrderListFilter } from '@tubutree/app-core/api/orders';

export type OrdersTabKey = 'all' | 'pending_payment' | 'processing' | 'shipping' | 'delivered' | 'closed' | 'subscriptions';

export interface OrdersTab {
  key: OrdersTabKey;
  label: string;
  /** Không có filter = tab không phải danh sách đơn (Định kỳ). */
  filter?: OrderListFilter;
}

/**
 * Tab trang Đơn hàng, cùng thứ tự và nhóm với Mini App. "Đang xử lý" gồm Đang đóng gói, "Đã hủy/hoàn" gồm Đã hoàn — hai
 * trạng thái này nếu không có nhóm thì chỉ thấy ở "Tất cả".
 */
export const ORDERS_TABS: readonly OrdersTab[] = [
  { key: 'all', label: 'Tất cả', filter: {} },
  { key: 'pending_payment', label: 'Chờ thanh toán', filter: { status: 'PENDING_PAYMENT' } },
  { key: 'processing', label: 'Đang xử lý', filter: { group: 'processing' } },
  { key: 'shipping', label: 'Đang giao', filter: { status: 'SHIPPING' } },
  { key: 'delivered', label: 'Đã giao', filter: { status: 'DELIVERED' } },
  { key: 'closed', label: 'Đã huỷ/hoàn', filter: { group: 'closed' } },
  { key: 'subscriptions', label: 'Định kỳ' },
];

export const ORDERS_TAB_KEYS: readonly string[] = ORDERS_TABS.map((t) => t.key);
