import { isPancakeForbiddenError, PANCAKE_FORBIDDEN_ERROR_PREFIX } from '@tubutree/shared-types';
import { PancakeApiError, PancakeOrderDataError, pancakeErrorText } from './pancake-outbound';

/**
 * Loại lỗi đẩy đơn sang Pancake, một nguồn cho processor, cron, admin và go-live:
 *  - DATA: dữ liệu đơn không đủ để tạo đơn kho (thiếu người nhận...). Cần người sửa đơn.
 *  - CONFIG: Pancake từ chối khoá API (401/403). Mọi đơn đều dính như nhau; phải sửa cấu hình, thử dồn chỉ đốt lượt.
 *  - CONFIG_RECHECK: KHÔNG do `classifyPushError` trả. Đơn đang CONFIG được chuyển sang đây khi khoá API vừa đẩy được một đơn khác
 *    (PancakeOrderService.saveCreated): cron thử lại bình thường (15 phút). Lần thử này lại 401/403 thì khoá không còn là nguyên nhân
 *    chung mà là lỗi riêng của đơn → REJECTED (`kindAfterFailure`). Không tính vào báo động tổng `pancake.config`.
 *  - REJECTED: Pancake từ chối dứt khoát dữ liệu đơn (4xx khác, `success:false`), hoặc 401/403 riêng của một đơn (xem trên).
 *  - TRANSIENT: mất kết nối, timeout, 5xx, 408/429 ở mọi lệnh; 409/425 CHỈ ở lệnh tạo đơn (ở huỷ/PUT là từ chối dứt khoát). Thử lại sau là hợp lý.
 */
export const PUSH_ERROR_KIND = {
  DATA: 'DATA',
  CONFIG: 'CONFIG',
  CONFIG_RECHECK: 'CONFIG_RECHECK',
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

export interface PriorPushError {
  pancakeErrorKind: string | null | undefined;
  pancakeSyncError: string | null | undefined;
}

/**
 * Loại lỗi GHI cho đơn sau một lượt đẩy lỗi, theo lần lỗi TRƯỚC của chính đơn đó. Khác `classifyPushError` ở hai chỗ:
 *  - 401/403 là lỗi riêng của đơn (REJECTED: đốt lượt, nhịp 60 phút, báo đơn) khi đơn đã được thả khỏi nhóm CONFIG (CONFIG_RECHECK, tức
 *    khoá vừa đẩy được đơn khác), hoặc đã REJECTED chính vì 401/403 (lời lỗi cũ mang tiền tố). REJECTED vì lý do khác (422...) gặp 401 là
 *    dấu hiệu khoá hỏng: CONFIG, góp vào báo động tổng.
 *  - Lỗi tạm không xoá dấu CONFIG_RECHECK: 503/429 chen giữa rồi 403 vẫn là lỗi riêng của đơn.
 * Đánh đổi chấp nhận (chỉ báo từng đơn, không báo động tổng; đơn khác cùng dính nên vẫn có người biết): khoá bị thu hồi đúng giữa lúc
 * thả nhóm và lượt thử kế tiếp thì đơn CONFIG_RECHECK cũng thành REJECTED; và một đơn MỚI (loại trước đó trống) gặp 401 đúng lúc một
 * request bắt đầu trước khi thu hồi khoá vẫn thành công và chạy saveCreated (thả nhóm) cũng có thể thành REJECTED ở lượt thử sau.
 */
export function kindAfterFailure(err: unknown, prior: PriorPushError): PushErrorKind {
  const kind = classifyPushError(err);
  const priorKind = prior.pancakeErrorKind;
  if (kind === PUSH_ERROR_KIND.CONFIG) {
    if (priorKind === PUSH_ERROR_KIND.CONFIG_RECHECK) return PUSH_ERROR_KIND.REJECTED;
    if (priorKind === PUSH_ERROR_KIND.REJECTED && isPancakeForbiddenError(prior.pancakeSyncError)) return PUSH_ERROR_KIND.REJECTED;
    return kind;
  }
  if (kind === PUSH_ERROR_KIND.TRANSIENT && priorKind === PUSH_ERROR_KIND.CONFIG_RECHECK) return PUSH_ERROR_KIND.CONFIG_RECHECK;
  return kind;
}

/**
 * Lời lỗi ghi vào `pancakeSyncError`. 401/403 đã tính là REJECTED (lỗi riêng đơn) mang tiền tố của shared-types để admin web hiện đúng
 * câu hướng dẫn mà không dò chuỗi tự do.
 */
export function storedErrorText(err: unknown, kind: PushErrorKind): string {
  const forbidden = err instanceof PancakeApiError && (err.status === 401 || err.status === 403);
  return forbidden && kind === PUSH_ERROR_KIND.REJECTED ? `${PANCAKE_FORBIDDEN_ERROR_PREFIX}${pancakeErrorText(err)}` : pancakeErrorText(err);
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
  // CONFIG: cả nhóm nghỉ, cron chỉ dò bằng một đơn mỗi giờ nên không có lần tự thử nào đáng hứa cho riêng đơn này.
  if (o.pancakeErrorKind === PUSH_ERROR_KIND.CONFIG) return null;
  if (o.pancakeOrderId || (o.status !== undefined && !PUSHABLE_STATUSES.includes(o.status))) return null;
  // Chỉ nhóm đang thử lại: chờ thanh toán/đủ hàng/vận đơn, STALE, chưa cấu hình, bỏ qua thì không có lần tự đẩy nào.
  if (o.pancakePushStatus !== null && !RETRYING_PUSH_STATUSES.includes(o.pancakePushStatus)) return null;
  if (now.getTime() - o.createdAt.getTime() >= PUSH_RETRY.MAX_AGE_HOURS * 3_600_000) return null;
  const slow = o.pancakePushAttempts >= PUSH_RETRY.SLOW_AFTER_ATTEMPTS || (o.pancakeErrorKind !== null && o.pancakeErrorKind !== PUSH_ERROR_KIND.TRANSIENT && o.pancakeErrorKind !== PUSH_ERROR_KIND.CONFIG_RECHECK);
  const interval = (slow ? PUSH_RETRY.SLOW_MINUTES : PUSH_RETRY.FAST_MINUTES) * 60_000;
  const earliest = Math.max((o.pancakeLastAttemptAt?.getTime() ?? 0) + interval, now.getTime());
  const tick = PUSH_RETRY.FAST_MINUTES * 60_000;
  const at = Math.ceil(earliest / tick) * tick;
  // Cron chỉ nhặt đơn đặt chưa quá MAX_AGE_HOURS: mốc rơi sau đó thì không còn lần tự thử nào.
  if (at - o.createdAt.getTime() >= PUSH_RETRY.MAX_AGE_HOURS * 3_600_000) return null;
  return new Date(at);
}

/**
 * Job push lỗi của đơn này còn việc cho người không? Đơn đã lên Pancake, đã huỷ/trả/giao (kể cả đã xoá) thì dấu lỗi chỉ còn là
 * rác chờ dọn; đơn khác (kể cả STALE, quá hạn tự đẩy) vẫn cần người quyết định. Dùng chung cho cron dọn và go-live.
 */
export function isPushFailureSettled(order: { status: string; pancakeOrderId: string | null } | null | undefined): boolean {
  if (!order) return true;
  return order.pancakeOrderId !== null || ['CANCELLED', 'RETURNED', 'DELIVERED'].includes(order.status);
}
