import type { OrderStatus } from '@tubutree/shared-types';

/**
 * Bảng chuyển trạng thái đơn hàng — NGUỒN CHÂN LÝ DUY NHẤT.
 *
 * Trước đây 4 nơi ghi status khác nhau (orders.service, admin.service,
 * merchant.service, pancake.processor) mỗi nơi tự validate (hoặc không) →
 * DELIVERED có thể bị lùi về CONFIRMED rồi user tự "cancel" lại, hoàn tiền/
 * restock lần 2 trên đơn đã giao (xem docs/2026-09-08-review-progress.md P0-1).
 * Mọi service ghi Order.status BẮT BUỘC gọi assertTransition() trước khi update.
 *
 * Quy tắc: FORWARD_CHAIN là thứ tự vận đơn thật (PENDING_PAYMENT → … → DELIVERED).
 * Được phép NHẢY CÓC về phía trước (vd CONFIRMED → DELIVERED thẳng) vì Pancake/POS
 * thường không báo đủ từng bước PACKED/SHIPPING — chặn nhảy cóc sẽ làm rớt webhook
 * DELIVERED hợp lệ. Đóng băng: KHÔNG được lùi (DELIVERED → CONFIRMED), không được
 * thoát khỏi CANCELLED/RETURNED (trạng thái cuối), DELIVERED chỉ đi tiếp được duy
 * nhất sang RETURNED. Self-transition luôn hợp lệ — webhook/cron gọi lại idempotent
 * không được ném lỗi.
 */
const FORWARD_CHAIN: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PACKED',
  'SHIPPING',
  'DELIVERED',
];

function buildTransitions(): Record<OrderStatus, readonly OrderStatus[]> {
  const table = {} as Record<OrderStatus, OrderStatus[]>;
  FORWARD_CHAIN.forEach((status, i) => {
    // Từ mọi mốc TRƯỚC delivered: đi tới chính nó, bất kỳ mốc sau (kể cả nhảy cóc), hoặc hủy.
    table[status] = [status, ...FORWARD_CHAIN.slice(i + 1), 'CANCELLED'];
  });
  // DELIVERED không nằm trong nhóm "hủy được" ở trên — override: chỉ RETURNED hoặc chính nó.
  table.DELIVERED = ['DELIVERED', 'RETURNED'];
  table.RETURNED = ['RETURNED'];
  table.CANCELLED = ['CANCELLED'];
  return table;
}

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = buildTransitions();

/** Trạng thái cuối — không còn đường ra (không tính self-transition). */
export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].every((s) => s === status);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export class InvalidOrderTransitionError extends Error {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
  ) {
    super(`Không thể chuyển đơn từ ${from} sang ${to}.`);
    this.name = 'InvalidOrderTransitionError';
  }
}

/** Ném InvalidOrderTransitionError nếu chuyển trạng thái không hợp lệ. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new InvalidOrderTransitionError(from, to);
}
