import { PancakeApiError, PancakeOrderDataError } from './pancake-outbound';

/**
 * Loại lỗi đẩy đơn sang Pancake, một nguồn cho processor, cron, admin và go-live:
 *  - DATA: dữ liệu đơn không đủ để tạo đơn kho (thiếu người nhận...). Cần người sửa đơn.
 *  - CONFIG: Pancake từ chối khoá API (401/403). Mọi đơn đều dính như nhau; phải sửa cấu hình, thử dồn chỉ đốt lượt.
 *  - REJECTED: Pancake từ chối dứt khoát dữ liệu đơn (4xx khác, `success:false`).
 *  - TRANSIENT: mất kết nối, timeout, 5xx, 408/409/425/429 — thử lại sau là hợp lý.
 */
export const PUSH_ERROR_KIND = {
  DATA: 'DATA',
  CONFIG: 'CONFIG',
  REJECTED: 'REJECTED',
  TRANSIENT: 'TRANSIENT',
} as const;
export type PushErrorKind = (typeof PUSH_ERROR_KIND)[keyof typeof PUSH_ERROR_KIND];

/** Lỗi không thuộc loại nào ở trên (lỗi DB, lỗi mã) coi là tạm: không nên đóng cửa thử lại vì một lỗi chưa rõ nguyên nhân. */
export function classifyPushError(err: unknown): PushErrorKind {
  if (err instanceof PancakeOrderDataError) return PUSH_ERROR_KIND.DATA;
  if (!(err instanceof PancakeApiError) || err.transient) return PUSH_ERROR_KIND.TRANSIENT;
  if (err.status === 401 || err.status === 403) return PUSH_ERROR_KIND.CONFIG;
  return PUSH_ERROR_KIND.REJECTED;
}

export const isPermanentPushError = (kind: PushErrorKind): boolean => kind !== PUSH_ERROR_KIND.TRANSIENT;

export const PUSH_ERROR_KINDS: readonly string[] = Object.values(PUSH_ERROR_KIND);

/** Nhịp thử lại tự động của cron cứu hộ (PancakePushReconcileService dùng chung các hằng này). */
export const PUSH_RETRY = {
  FAST_MINUTES: 15,
  SLOW_MINUTES: 60,
  /** Đơn đã bị đẩy lỗi từng này lượt thì cron chỉ thử mỗi SLOW_MINUTES. */
  SLOW_AFTER_ATTEMPTS: 20,
  /** Quá mốc này kể từ lúc đặt, đơn chưa lên Pancake thì không tự đẩy nữa. */
  MAX_AGE_HOURS: 72,
} as const;

const PUSHABLE_STATUSES: readonly string[] = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'];
const RETRYING_PUSH_STATUSES: readonly string[] = ['PENDING', 'FAILED', 'PUSHING'];

export interface PushRetryInput {
  status?: string;
  pancakeOrderId: string | null;
  pancakePushStatus: string | null;
  pancakeErrorKind: string | null;
  pancakePushAttempts: number;
  pancakeLastAttemptAt: Date | null;
  createdAt: Date;
}

/**
 * Lần cron tự thử lại kế tiếp (cron chạy mỗi 15 phút, đúng mốc :00 :15 :30 :45), hoặc null khi không còn lần nào: đã lên Pancake, đang
 * STALE (người phải bấm "Đẩy lại"), hay quá cửa sổ tự đẩy. Lỗi vĩnh viễn cũng được hỏi lại, nhưng thưa (mỗi giờ).
 */
export function nextPushRetryAt(o: PushRetryInput, now: Date = new Date()): Date | null {
  if (o.pancakeOrderId || (o.status !== undefined && !PUSHABLE_STATUSES.includes(o.status))) return null;
  // Chỉ nhóm đang thử lại: chờ thanh toán/đủ hàng/vận đơn, STALE, chưa cấu hình, bỏ qua thì không có lần tự đẩy nào.
  if (o.pancakePushStatus !== null && !RETRYING_PUSH_STATUSES.includes(o.pancakePushStatus)) return null;
  if (now.getTime() - o.createdAt.getTime() >= PUSH_RETRY.MAX_AGE_HOURS * 3_600_000) return null;
  const slow = o.pancakePushAttempts >= PUSH_RETRY.SLOW_AFTER_ATTEMPTS || (o.pancakeErrorKind !== null && o.pancakeErrorKind !== PUSH_ERROR_KIND.TRANSIENT);
  const interval = (slow ? PUSH_RETRY.SLOW_MINUTES : PUSH_RETRY.FAST_MINUTES) * 60_000;
  const earliest = Math.max((o.pancakeLastAttemptAt?.getTime() ?? 0) + interval, now.getTime());
  const tick = PUSH_RETRY.FAST_MINUTES * 60_000;
  return new Date(Math.ceil(earliest / tick) * tick);
}

/**
 * Job push lỗi của đơn này còn việc cho người không? Đơn đã lên Pancake, đã huỷ/trả/giao (kể cả đã xoá) thì dấu lỗi chỉ còn là
 * rác chờ dọn; đơn khác (kể cả STALE, quá hạn tự đẩy) vẫn cần người quyết định. Dùng chung cho cron dọn và go-live.
 */
export function isPushFailureSettled(order: { status: string; pancakeOrderId: string | null } | null | undefined): boolean {
  if (!order) return true;
  return order.pancakeOrderId !== null || ['CANCELLED', 'RETURNED', 'DELIVERED'].includes(order.status);
}
