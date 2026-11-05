import { trimInvisible } from '../../common/text-trim';
import { CUSTOMER_CANCEL_NOTE_PREFIX } from './cancel-reasons';

/** Tiền tố AdminService.updateOrderStatus gắn vào ghi chú lịch sử khi admin nhập lý do (cùng chữ đó được gửi khách trong tin huỷ). */
export const ADMIN_ORDER_NOTE_PREFIX = 'Admin: ';

export interface CancelHistoryRow {
  fromStatus: string;
  toStatus: string;
  actorType: string;
  note: string | null;
  createdAt: Date;
}

const CONTACT = 'Cần biết thêm, bạn liên hệ CSKH.';
const CUSTOMER_PLAIN = 'Bạn đã huỷ đơn này';
const SYSTEM_EXPIRED = 'Đơn tự huỷ vì quá hạn thanh toán';
const GENERIC = 'Đơn đã được huỷ';
const TUBU_FIXED = `Tubu Tree đã huỷ đơn này. ${CONTACT}`;
const MERCHANT_FIXED = `Gian hàng đã huỷ đơn này. ${CONTACT}`;
/** Ghi chú cron pending-payment-expiry: "Tự huỷ: quá N giờ chưa thanh toán[ — đã mở lệnh <cổng>: đối chiếu ...]"; phần sau dấu gạch là gợi ý nội bộ. */
const SYSTEM_EXPIRY_NOTE = /^Tự huỷ: quá [\d.,]+ giờ chưa thanh toán/;
/** Chữ của chính khách (tối đa 200 ký tự ở DTO) và lý do admin/gian hàng (tối đa 500) đã được gửi cho khách; cắt thêm để không trả chuỗi dài bất thường. */
const CUSTOMER_TEXT_MAX = 300;
const REASON_MAX = 500;

const withReason = (lead: string, reason: string | null) => (reason ? `${lead} Lý do: ${reason}` : `${lead} ${CONTACT}`);

/** Lý do khách đã đọc trong tin huỷ: bỏ tiền tố (nếu có), khoảng trắng và dấu chấm cuối, như câu "Lý do: ..." của tin ORDER_CANCELLED. */
function sentReason(note: string | null, prefix: string): string | null {
  if (note === null || !note.startsWith(prefix)) return null;
  const text = trimInvisible(note.slice(prefix.length)).replace(/[.\s]+$/, '');
  return text ? text.slice(0, REASON_MAX) : null;
}

/**
 * Lý do huỷ đơn để hiện cho KHÁCH (chi tiết đơn phía khách). Chỉ trả chuỗi an toàn: ghi chú nội bộ (gợi ý hoàn tay, đối chiếu cổng, Pancake)
 * không bao giờ lọt ra. Ghi chú chỉ được dùng khi chính chữ đó đã được gửi cho khách ở tin huỷ: chữ khách tự chọn, lý do admin (customerReason),
 * lý do gian hàng (MERCHANT_ORDER_CANCELLED_BY_SELLER). Không có dòng huỷ nào thì null.
 *
 * Chọn dòng huỷ mới nhất có fromStatus khác CANCELLED: Pancake còn ghi dòng đánh dấu CANCELLED → CANCELLED (khoản chờ đối chiếu trên đơn đã huỷ),
 * dòng đó không nói ai đã huỷ.
 */
export function customerCancelReason(history: readonly CancelHistoryRow[]): string | null {
  let latest: CancelHistoryRow | null = null;
  for (const r of history) {
    if (r.toStatus !== 'CANCELLED' || r.fromStatus === 'CANCELLED') continue;
    if (!latest || r.createdAt.getTime() >= latest.createdAt.getTime()) latest = r;
  }
  if (!latest) return null;
  const { actorType, note } = latest;
  switch (actorType) {
    case 'CUSTOMER': {
      if (note === null || !note.startsWith(CUSTOMER_CANCEL_NOTE_PREFIX)) return CUSTOMER_PLAIN;
      const text = trimInvisible(note.slice(CUSTOMER_CANCEL_NOTE_PREFIX.length));
      return text ? `Bạn đã huỷ: ${text.slice(0, CUSTOMER_TEXT_MAX)}` : CUSTOMER_PLAIN;
    }
    case 'SYSTEM':
      return note !== null && SYSTEM_EXPIRY_NOTE.test(note) ? SYSTEM_EXPIRED : GENERIC;
    case 'ADMIN':
      return withReason('Tubu Tree đã huỷ đơn này.', sentReason(note, ADMIN_ORDER_NOTE_PREFIX));
    case 'MERCHANT': {
      const reason = note === null ? null : trimInvisible(note).replace(/[.\s]+$/, '').slice(0, REASON_MAX);
      return reason ? `Gian hàng đã huỷ đơn này. Lý do: ${reason}` : MERCHANT_FIXED;
    }
    case 'PANCAKE':
      return TUBU_FIXED;
    default:
      return GENERIC;
  }
}
