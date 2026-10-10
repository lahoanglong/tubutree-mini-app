import type { OrderStatus, PaymentMethod } from '@tubutree/shared-types';

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
    message?: string,
  ) {
    super(message ?? `Không thể chuyển đơn từ ${from} sang ${to}.`);
    this.name = 'InvalidOrderTransitionError';
  }
}

/** Ném InvalidOrderTransitionError nếu chuyển trạng thái không hợp lệ. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new InvalidOrderTransitionError(from, to);
}

/**
 * Trạng thái mà đơn TRẢ TRƯỚC chỉ được vào khi đã PAID: hàng rời kho (SHIPPING) và giao xong
 * (DELIVERED — mốc cộng điểm Xanh, chốt hoa hồng CTV, thưởng giới thiệu). Trước đây đơn chuyển
 * khoản chưa ai trả vẫn đẩy được lên DELIVERED và nhận đủ các khoản đó (C-024).
 */
const PAYMENT_GATED_STATUSES: readonly OrderStatus[] = ['SHIPPING', 'DELIVERED'];

/**
 * Ngoài SHIPPING/DELIVERED, đơn trả trước cũng không được RỜI PENDING_PAYMENT (trừ huỷ) khi chưa PAID: lối ra
 * hợp lệ duy nhất là "Đã nhận tiền"/callback thanh toán. Đẩy tay sang CONFIRMED/PACKED khi chưa trả làm đơn
 * thoát khỏi cron tự huỷ quá hạn (chỉ quét PENDING_PAYMENT) → kho, quota flash, coupon bị giữ vĩnh viễn.
 */
export function requiresPaymentBefore(from: OrderStatus, to: OrderStatus): boolean {
  if (PAYMENT_GATED_STATUSES.includes(to)) return true;
  return from === 'PENDING_PAYMENT' && to !== 'PENDING_PAYMENT' && to !== 'CANCELLED';
}

/**
 * Record đầy đủ theo enum: thêm phương thức thanh toán mới thì tsc buộc phải xếp loại ở đây, không
 * lặng lẽ lọt khỏi luật "trả trước phải PAID mới được giao".
 */
const PREPAID_METHOD: Record<PaymentMethod, boolean> = {
  COD: false,
  ZALOPAY: true,
  VNPAY: true,
  BANK_TRANSFER: true,
  WALLET: true,
  XU: true,
};

export const PREPAID_METHODS: readonly PaymentMethod[] = (Object.keys(PREPAID_METHOD) as PaymentMethod[]).filter(
  (m) => PREPAID_METHOD[m],
);

export function isPrepaidMethod(paymentMethod: string): boolean {
  return PREPAID_METHOD[paymentMethod as PaymentMethod] === true;
}

/** Lý do riêng để admin thấy cần bấm "Đã nhận tiền"; vẫn là lỗi chuyển trạng thái nên webhook bỏ qua êm. */
export class UnpaidPrepaidTransitionError extends InvalidOrderTransitionError {
  constructor(code: string, paymentMethod: string, from: OrderStatus, to: OrderStatus) {
    super(
      from,
      to,
      `Đơn ${code} trả trước (${paymentMethod}) chưa được ghi nhận thanh toán — xác nhận "Đã nhận tiền" trước khi chuyển sang ${to}.`,
    );
    this.name = 'UnpaidPrepaidTransitionError';
  }
}

/**
 * `onCredit`: đơn đại lý ghi công nợ — BANK_TRANSFER + UNPAID suốt đời (trả qua sổ công nợ, không bao
 * giờ lật PAID) nên được giao như thường.
 */
export function assertPaidBeforeFulfilment(
  order: { code: string; paymentMethod: string; paymentStatus: string; onCredit?: boolean },
  from: OrderStatus,
  to: OrderStatus,
): void {
  if (!requiresPaymentBefore(from, to) || !isPrepaidMethod(order.paymentMethod)) return;
  if (order.paymentStatus === 'PAID' || order.onCredit) return;
  throw new UnpaidPrepaidTransitionError(order.code, order.paymentMethod, from, to);
}

/**
 * Các trạng thái đơn được phép chuyển tới ngay lúc này (không gồm chính nó) — cùng luật với
 * OrderStatusService.setStatus (bảng chuyển + khoá giao khi trả trước chưa PAID), để web admin chỉ hiện nút
 * mà API sẽ nhận. Trạng thái lạ trả rỗng thay vì ném: dùng cho danh sách, một dòng hỏng không được làm sập cả trang.
 */
export function allowedNextStatuses(order: {
  status: string;
  code: string;
  paymentMethod: string;
  paymentStatus: string;
  onCredit?: boolean;
}): OrderStatus[] {
  const from = order.status as OrderStatus;
  if (!Object.prototype.hasOwnProperty.call(ORDER_TRANSITIONS, from)) return [];
  return ORDER_TRANSITIONS[from].filter((to) => {
    if (to === from) return false;
    try {
      assertPaidBeforeFulfilment(order, from, to);
      return true;
    } catch {
      return false;
    }
  });
}
