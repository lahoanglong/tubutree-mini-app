import { viOrderStatus, viOrders } from '../../i18n/vi-orders';
import type { OrderListFilter } from '../../services/shop-api';
import { SUBSCRIPTIONS_IN_MINIAPP } from '../../utils/features';

export type OrdersTabKey = 'all' | 'pending_payment' | 'processing' | 'shipping' | 'delivered' | 'closed' | 'subscriptions';

export interface OrdersTab {
  key: OrdersTabKey;
  label: string;
  /** Không có filter = tab không phải danh sách đơn (Định kỳ). */
  filter?: OrderListFilter;
}

/** Tab trang Đơn hàng (spec 4a.2 + Ruling 1). "Đang xử lý" gồm Đang đóng gói, "Đã hủy/hoàn" gồm
 * Đã hoàn — hai trạng thái trước đây chỉ thấy ở "Tất cả" (A2-47). */
const ALL_ORDERS_TABS: readonly OrdersTab[] = [
  { key: 'all', label: viOrders.tabAll, filter: {} },
  { key: 'pending_payment', label: viOrderStatus.PENDING_PAYMENT!, filter: { status: 'PENDING_PAYMENT' } },
  { key: 'processing', label: viOrders.tabProcessing, filter: { group: 'processing' } },
  { key: 'shipping', label: viOrders.tabShipping, filter: { status: 'SHIPPING' } },
  { key: 'delivered', label: viOrders.tabDelivered, filter: { status: 'DELIVERED' } },
  { key: 'closed', label: viOrders.tabClosed, filter: { group: 'closed' } },
  { key: 'subscriptions', label: viOrders.tabSubscriptions },
];

/**
 * Tab của trang Đơn hàng. Mini App không có lối tạo gói định kỳ (cờ tắt) nhưng khách đặt trên web vẫn phải xem và quản lý gói được,
 * nên tab "Định kỳ" hiện khi cờ bật HOẶC khách đã có gói đang chạy/tạm dừng.
 */
export function ordersTabs(hasSubscription: boolean): readonly OrdersTab[] {
  return SUBSCRIPTIONS_IN_MINIAPP || hasSubscription ? ALL_ORDERS_TABS : ALL_ORDERS_TABS.filter((t) => t.key !== 'subscriptions');
}

/** Tab cho khách chưa có gói: nơi chỉ cần các tab trạng thái đơn (vd số đơn ở trang Cá nhân). */
export const ORDERS_TABS: readonly OrdersTab[] = ordersTabs(false);

export function parseOrdersTab(search: string, tabs: readonly OrdersTab[] = ORDERS_TABS): OrdersTabKey {
  const v = new URLSearchParams(search).get('tab');
  return tabs.some((t) => t.key === v) ? (v as OrdersTabKey) : 'all';
}
