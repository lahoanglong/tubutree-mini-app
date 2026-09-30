import type { OrderStatus } from '@tubutree/shared-types';

/** Đơn "đang xử lý" — badge tab Đơn hàng (spec 4a.1). */
export const ACTIVE_ORDER_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'] as const satisfies readonly OrderStatus[];

/** Nhóm trạng thái cho tab gộp của trang Đơn hàng (spec 4a.2, A2-47). */
export const ORDER_STATUS_GROUPS = {
  processing: ['CONFIRMED', 'PACKED'],
  closed: ['CANCELLED', 'RETURNED'],
} as const satisfies Record<string, readonly OrderStatus[]>;

export type OrderStatusGroup = keyof typeof ORDER_STATUS_GROUPS;
export const ORDER_STATUS_GROUP_KEYS = Object.keys(ORDER_STATUS_GROUPS) as OrderStatusGroup[];
