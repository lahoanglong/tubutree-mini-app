import type { Prisma } from '@prisma/client';
import { PUSH_ERROR_KIND } from './pancake-push-error';

/**
 * Loại lỗi đẩy mà "Đẩy lại đơn tạm lỗi" (một chạm hoặc hàng loạt ở Sức khoẻ hệ thống) nhận: Pancake tạm lỗi, hoặc khoá vừa đẩy được đơn khác.
 * DATA/REJECTED phải sửa đơn trước (đẩy lại chỉ lỗi lần nữa); CONFIG là khoá API hỏng (đẩy từng đơn vô ích, báo kỹ thuật).
 */
export const BULK_RETRY_KINDS: readonly string[] = [PUSH_ERROR_KIND.TRANSIENT, PUSH_ERROR_KIND.CONFIG_RECHECK];
/** Mỗi lần bấm nhận tối đa bấy nhiêu đơn (bằng số đơn kẹt màn Sức khoẻ hệ thống liệt kê). */
export const BULK_RETRY_MAX = 20;
/**
 * Trần thời gian tổng của một lần bấm. Các đơn xét lần lượt, mỗi đơn vài lệnh DB và Redis (mỗi lệnh Redis chờ tối đa QUEUE_COMMAND_TIMEOUT_MS): lúc Redis
 * chậm, 20 đơn giữ request quá giờ chờ của web và người bấm không biết đơn nào đã xếp. Hết trần thì đơn chưa tới lượt trả "chưa xét" để bấm lại.
 * Đơn đang xét dở không bị cắt ngang: cắt giữa chừng thì lệnh đẩy vẫn có thể đã xếp mà câu trả lời lại nói chưa.
 */
export const BULK_RETRY_BUDGET_MS = 15_000;

/** Trạng thái đẩy "quá hạn tự đẩy" (`PANCAKE_PUSH.STALE`); ghi chữ ở đây để file này không nhập vòng từ pancake-order.service. */
const STALE = 'STALE';

/**
 * Lời từ chối riêng của lối đẩy lại đơn tạm lỗi, cộng THÊM vào cổng đẩy chung (`pushRetryGateDecision` + môi trường, do `retryPushByAdmin` xét).
 * null = lối này nhận. Đơn STALE không nhận: phải người kiểm kho đã giao tay chưa rồi bấm "Đẩy lại Pancake" ở chi tiết đơn, từng đơn một.
 */
export function bulkRetryRefusal(o: { code: string; pancakePushStatus: string | null; pancakeErrorKind: string | null }): string | null {
  if (o.pancakePushStatus === STALE) {
    return `Đơn ${o.code} đã quá hạn tự đẩy: kiểm kho đã giao tay chưa, rồi bấm "Đẩy lại Pancake" ở chi tiết đơn.`;
  }
  if (o.pancakeErrorKind && BULK_RETRY_KINDS.includes(o.pancakeErrorKind)) return null;
  switch (o.pancakeErrorKind) {
    case PUSH_ERROR_KIND.DATA:
    case PUSH_ERROR_KIND.REJECTED:
      return `Đơn ${o.code} thiếu dữ liệu hoặc bị Pancake từ chối: sửa đơn rồi bấm "Đẩy lại Pancake" ở chi tiết đơn.`;
    case PUSH_ERROR_KIND.CONFIG:
      return `Đơn ${o.code} kẹt vì khoá API Pancake đang bị từ chối: báo kỹ thuật, đẩy lại từng đơn không giúp gì.`;
    default:
      return `Đơn ${o.code} chưa có lỗi tạm nào để thử lại: mở chi tiết đơn để xem.`;
  }
}

/** Cùng nghĩa với `bulkRetryRefusal`, ghép vào câu ghi có điều kiện của "Đẩy lại": cron đổi loại lỗi giữa lúc đọc và lúc ghi thì không ghi. */
export const BULK_RETRY_WHERE: Prisma.OrderWhereInput = {
  pancakeErrorKind: { in: [...BULK_RETRY_KINDS] },
  OR: [{ pancakePushStatus: null }, { pancakePushStatus: { not: STALE } }],
};

export interface BulkRetryResult {
  ok: true;
  queued: number;
  skipped: number;
  /**
   * Theo đúng thứ tự gửi lên; `message` là câu xác nhận hoặc lời từ chối của từng đơn. `unchecked`: đơn chưa tới lượt xét vì lần bấm đã hết
   * BULK_RETRY_BUDGET_MS (đơn không đổi gì, bấm lại là xét tiếp).
   */
  results: { id: string; ok: boolean; message: string; unchecked?: true }[];
  message: string;
}

/** Lời của một đơn chưa tới lượt xét. */
export const bulkRetryUncheckedMessage = (code: string): string => `Đơn ${code} chưa xét: lượt bấm đã chạy hết ${BULK_RETRY_BUDGET_MS / 1000} giây.`;

/** Câu tổng cho người bấm: số đơn đã xếp lệnh, tối đa 3 lời từ chối đầu (mỗi lời đã nêu mã đơn), và số đơn chưa xét nếu hết thời gian. */
export function bulkRetryMessage(results: BulkRetryResult['results']): string {
  const queued = results.filter((r) => r.ok).length;
  const refused = results.filter((r) => !r.ok && !r.unchecked);
  const unchecked = results.filter((r) => r.unchecked).length;
  const tail =
    unchecked > 0 ? ` Hết ${BULK_RETRY_BUDGET_MS / 1000} giây của lượt bấm: còn ${unchecked} đơn chưa xét, bấm "Đẩy lại" lần nữa để xét tiếp.` : '';
  const head = `Đã xếp lệnh đẩy ${queued}/${results.length} đơn sang Pancake.`;
  if (refused.length === 0) return `${head}${tail}`;
  const shown = refused.slice(0, 3).map((r) => r.message);
  const more = refused.length > shown.length ? ` Còn ${refused.length - shown.length} đơn khác không đẩy lại.` : '';
  if (queued === 0) return `Không đơn nào được xếp lệnh đẩy. ${shown.join(' ')}${more}${tail}`;
  return `${head} Không đẩy lại: ${shown.join(' ')}${more}${tail}`;
}
