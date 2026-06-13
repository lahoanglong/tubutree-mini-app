import type { OrderStatus } from '@tubutree/shared-types';

/**
 * Map trạng thái Pancake → OrderStatus của Tubu.
 * Pancake dùng cả mã số lẫn chuỗi tùy cấu hình; cover các giá trị phổ biến,
 * không khớp → trả null (giữ nguyên trạng thái hiện tại).
 */
const MAP: Record<string, OrderStatus> = {
  // numeric codes (Pancake order status thường gặp)
  '0': 'PENDING_PAYMENT',
  '1': 'CONFIRMED',
  '2': 'PACKED',
  '3': 'SHIPPING',
  '11': 'SHIPPING',
  '16': 'DELIVERED',
  '15': 'DELIVERED',
  '6': 'CANCELLED',
  '4': 'RETURNED',
  // string codes
  new: 'PENDING_PAYMENT',
  confirmed: 'CONFIRMED',
  packed: 'PACKED',
  shipping: 'SHIPPING',
  shipped: 'SHIPPING',
  delivered: 'DELIVERED',
  completed: 'DELIVERED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  returned: 'RETURNED',
};

export function mapPancakeStatus(raw: unknown): OrderStatus | null {
  if (raw === null || raw === undefined) return null;
  const key = String(raw).trim().toLowerCase();
  return MAP[key] ?? null;
}
