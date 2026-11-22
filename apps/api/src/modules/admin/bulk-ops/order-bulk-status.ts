import type { OrderStatus, Prisma } from '@prisma/client';
import { actorTransitionBlock, type OrderActor } from '../order-actor-transitions';
import {
  InvalidOrderTransitionError,
  assertPaidBeforeFulfilment,
  assertTransition,
  cancelAfterHandoverMessage,
  cancelHandover,
  orderStatusLabelVi,
} from '../../orders/order-transition';

/** Trần mã đơn mỗi lượt đổi trạng thái hàng loạt: một lượt đọc lại và đổi từng đơn tuần tự, 50 đơn xong trong vài giây. */
export const BULK_STATUS_MAX = 50;

/**
 * Đích đổi hàng loạt: chỉ hai nút tay của nhân viên (KHO đánh dấu Đã đóng gói, CSKH huỷ). Giao vận/Đã giao do Pancake báo về; một lượt
 * DELIVERED hàng loạt bấm nhầm cộng điểm, chốt hoa hồng và doanh thu cho cả trang đơn, nên không mở ở đây kể cả cho ADMIN.
 */
export const BULK_STATUS_TARGETS = ['PACKED', 'CANCELLED'] as const satisfies readonly OrderStatus[];
export type BulkStatusTarget = (typeof BULK_STATUS_TARGETS)[number];

/** `admin_audit_logs.action` của mỗi lượt đổi thật. */
export const BULK_STATUS_ACTION = 'ORDER_BULK_STATUS';

/** Đủ cột để xét trước một lần chuyển mà không gọi ra ngoài: bảng chuyển trạng thái, nhóm việc, mốc bàn giao, đã trả tiền. */
export const BULK_ORDER_SELECT = {
  id: true,
  code: true,
  status: true,
  type: true,
  paymentMethod: true,
  paymentStatus: true,
  fulfiller: true,
  pancakeOrderId: true,
  shippingCode: true,
  shippingPartner: true,
  shippedAt: true,
  hasRecyclingPickup: true,
  gomdonStatus: true,
  gomdonOrderId: true,
  gomdonPartnerCode: true,
} satisfies Prisma.OrderSelect;

export type BulkOrder = Prisma.OrderGetPayload<{ select: typeof BULK_ORDER_SELECT }>;

/**
 * Kết quả từng đơn. READY: xem trước, sẽ đổi. UPDATED: lượt thật này đổi (câu đổi có điều kiện của chính lượt này đổi dòng đơn).
 * SKIPPED: đơn đã ở trạng thái đích, từ trước hoặc vì thao tác khác (admin khác, webhook) vừa đổi trước; không phải lỗi, không ghi gì.
 * FAILED: không đổi được (luật chuyển trạng thái, nhóm việc, đơn vừa sang trạng thái khác, lỗi máy chủ).
 */
export type BulkItemOutcome = 'READY' | 'UPDATED' | 'SKIPPED' | 'FAILED';

export interface BulkStatusResult {
  /** Đúng chuỗi người gửi (id hoặc mã đơn). */
  id: string;
  code: string | null;
  from: OrderStatus | null;
  /** true khi READY/UPDATED. */
  ok: boolean;
  outcome: BulkItemOutcome;
  /** Lý do không đổi (hoặc sẽ không đổi khi xem trước). null khi ok. */
  reason: string | null;
}

/** Bỏ khoảng trắng hai đầu, bỏ trùng, giữ thứ tự người gửi. */
export function uniqueIds(raw: readonly string[]): string[] {
  return [...new Set(raw.map((s) => s.trim()).filter(Boolean))];
}

/**
 * Vì sao đơn này không sang được `to` (null = sang được), theo đúng các luật `AdminService.updateOrderStatus` sẽ áp khi đổi thật:
 * nhóm việc của người bấm, bảng chuyển trạng thái, mốc bàn giao vận chuyển (không huỷ được nữa), đơn trả trước chưa trả tiền.
 * Đơn đã ở `to` không tính là đổi được: lượt hàng loạt báo "không cần đổi" thay vì ghi một dòng lịch sử rỗng.
 */
export function bulkStatusBlock(actor: OrderActor, order: BulkOrder, to: BulkStatusTarget, opts: { onCredit?: boolean } = {}): string | null {
  const from = order.status;
  if (from === to) return `Đơn ${order.code} đã ở «${orderStatusLabelVi(to)}», không cần đổi.`;
  const block = actorTransitionBlock(actor, order, to);
  if (block) return block.message;
  try {
    assertTransition(from, to);
    if (to === 'CANCELLED') {
      const handover = cancelHandover(order);
      if (handover) return cancelAfterHandoverMessage(order.code, handover);
    }
    assertPaidBeforeFulfilment({ ...order, onCredit: opts.onCredit === true }, from, to);
  } catch (err) {
    if (err instanceof InvalidOrderTransitionError) return err.message;
    throw err;
  }
  return null;
}
