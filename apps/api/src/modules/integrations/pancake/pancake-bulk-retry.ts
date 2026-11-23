import type { Prisma } from '@prisma/client';
import { PUSH_ERROR_KIND } from './pancake-push-error';

/**
 * Loại lỗi đẩy mà "Đẩy lại đơn tạm lỗi" (một chạm hoặc hàng loạt ở Sức khoẻ hệ thống) nhận: Pancake tạm lỗi, hoặc khoá vừa đẩy được đơn khác.
 * DATA/REJECTED phải sửa đơn trước (đẩy lại chỉ lỗi lần nữa); CONFIG là khoá API hỏng (đẩy từng đơn vô ích, báo kỹ thuật).
 */
export const BULK_RETRY_KINDS: readonly string[] = [PUSH_ERROR_KIND.TRANSIENT, PUSH_ERROR_KIND.CONFIG_RECHECK];
/** Mỗi lần bấm nhận tối đa bấy nhiêu đơn (bằng số đơn kẹt màn Sức khoẻ hệ thống liệt kê). */
export const BULK_RETRY_MAX = 20;

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
  /** Theo đúng thứ tự gửi lên; `message` là câu xác nhận hoặc lời từ chối của từng đơn. */
  results: { id: string; ok: boolean; message: string }[];
  message: string;
}

/** Câu tổng cho người bấm: số đơn đã xếp lệnh, và tối đa 3 lời từ chối đầu (mỗi lời đã nêu mã đơn). */
export function bulkRetryMessage(results: BulkRetryResult['results']): string {
  const queued = results.filter((r) => r.ok).length;
  const refused = results.filter((r) => !r.ok);
  const head = `Đã xếp lệnh đẩy ${queued}/${results.length} đơn sang Pancake.`;
  if (refused.length === 0) return head;
  const shown = refused.slice(0, 3).map((r) => r.message);
  const more = refused.length > shown.length ? ` Còn ${refused.length - shown.length} đơn khác không đẩy lại.` : '';
  if (queued === 0) return `Không đơn nào được xếp lệnh đẩy. ${shown.join(' ')}${more}`;
  return `${head} Không đẩy lại: ${shown.join(' ')}${more}`;
}
