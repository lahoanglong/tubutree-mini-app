import { formatDate } from './format-date';

const clamp = (n: number | undefined) => (Number.isFinite(n) ? Math.max(0, n as number) : 0);
/** Nhóm nghìn kiểu Việt: 1800 → "1.800". Dùng cho mọi số điểm/số lượng hiển thị. */
export const formatCount = (n: number) => n.toLocaleString('vi-VN');
const group = formatCount;
const CONVERTED_FULL_VALUE = ', trả tới 100% giá trị hàng';
const convertedPointsNote = (converted: number) => `trong đó ${group(converted)} điểm không hết hạn`;

/**
 * Điểm Xanh khách thấy: MỘT con số = lô thường (có hạn) + lô quy đổi từ xu cũ (không hết hạn, tiền trả trước).
 * Số âm hoặc rác → 0; phiên/API cũ chưa có lô quy đổi → 0.
 */
export function pointsSummary(u: { pointsBalance: number; pointsConvertedBalance?: number }): {
  standard: number;
  converted: number;
  total: number;
  convertedNote: string | null;
} {
  const standard = clamp(u.pointsBalance);
  const converted = clamp(u.pointsConvertedBalance);
  return {
    standard,
    converted,
    total: standard + converted,
    convertedNote: converted > 0 ? convertedPointsNote(converted) : null,
  };
}

/**
 * Dòng giải thích Điểm Xanh đang chờ mở khoá (cùng nguồn lockedPoints/lockedUntil với Mini App): mỗi phần một câu.
 * Rỗng khi không có điểm khoá hoặc API cũ chưa trả.
 */
export function lockedPointsLines(lock: { lockedPoints?: number; lockedReturnPoints?: number; lockedUntil?: string | null } | null | undefined): string[] {
  const locked = clamp(lock?.lockedPoints);
  if (!lock || locked <= 0) return [];
  const ret = Math.min(locked, clamp(lock.lockedReturnPoints));
  const inWindow = locked - ret;
  const lines: string[] = [];
  const day = lock.lockedUntil ? formatDate(lock.lockedUntil).slice(0, 5) : null;
  if (inWindow > 0) {
    lines.push(day && day !== '—' ? `${group(inWindow)} điểm đang chờ, mở khoá ngày ${day}` : `${group(inWindow)} điểm đang chờ mở khoá`);
  }
  if (ret > 0) lines.push(`${group(ret)} điểm đang chờ xử lý đổi/trả, mở khoá khi yêu cầu được xử lý xong`);
  return lines;
}

export interface CheckoutPointsOffer {
  usable: number;
  /** Phần lô quy đổi trong `usable`. */
  converted: number;
  lockNote: string | null;
  convertedNote: string | null;
}

/**
 * Điểm Xanh màn thanh toán web được đề nghị dùng:
 *  - lô thường: `redeemablePoints` của báo giá (số dư − điểm của đơn còn trong hạn đổi/trả hoặc đang chờ xử lý
 *    đổi/trả), KHÔNG phải số dư — CheckoutService kẹp báo giá và đặt đơn đúng theo số này (cùng luật đổi quà
 *    Điểm Xanh) và áp trần % giá trị hàng. API cũ chưa trả field → số dư (backend tự kẹp);
 *  - lô quy đổi: không hết hạn, không bị khoá, trả tới 100% giá trị hàng → cộng nguyên vào `usable`.
 * `usable` được gửi làm `pointsToUse`; backend tự chia hai lô và trả `pointsUsed` thật trong báo giá.
 */
export function checkoutPointsOffer(
  quote:
    | {
        pointsBalance: number;
        redeemablePoints?: number;
        lockedPoints?: number;
        pointsConvertedBalance?: number;
        redeemableConvertedPoints?: number;
      }
    | undefined,
): CheckoutPointsOffer {
  if (!quote) return { usable: 0, converted: 0, lockNote: null, convertedNote: null };
  const balance = clamp(quote.pointsBalance);
  const standardUsable = Math.min(balance, clamp(quote.redeemablePoints ?? balance));
  const held = balance - standardUsable;
  const converted = clamp(quote.redeemableConvertedPoints ?? quote.pointsConvertedBalance);
  return {
    usable: standardUsable + converted,
    converted,
    lockNote: held > 0 ? `${group(held)} điểm từ đơn mới giao chưa dùng được vì còn trong hạn hoặc đang chờ xử lý đổi/trả; sẽ dùng được khi hết hạn đổi/trả` : null,
    convertedNote: converted > 0 ? `${convertedPointsNote(converted)}${CONVERTED_FULL_VALUE}` : null,
  };
}

/**
 * Dòng điểm quy đổi dưới ô Điểm Xanh. Lô quy đổi trả tới 100% giá trị hàng, nhưng đơn bị trần (giỏ có hàng của gian hàng đối
 * tác, hoặc trần theo giá trị hàng thấp hơn số dùng được) thì không hứa câu đó, chỉ nói phần không hết hạn — cùng luật Mini App.
 */
export function convertedPointsLine(
  offer: CheckoutPointsOffer,
  cap: { capNote: string | null; partnerNote: string | null },
): string | null {
  if (offer.converted <= 0) return null;
  return cap.capNote || cap.partnerNote ? convertedPointsNote(offer.converted) : offer.convertedNote;
}

/**
 * Trần Điểm Xanh của đơn (`quote.pointsMax`, đã gồm số dư dùng được, trần theo giá trị hàng và luật hàng của gian hàng đối tác).
 * Khách chỉ thấy số thật được trừ sau khi tick, nên trước khi tick ô phải nêu trần khi nó thấp hơn số điểm dùng được:
 *  - giỏ có hàng của gian hàng đối tác (Điểm Xanh chỉ trả cho hàng Tubu): luôn nêu trần + câu giải thích báo giá trả về;
 *  - giỏ chỉ hàng Tubu: nêu trần khi nó nhỏ hơn `usable`;
 *  - trần 0: tắt ô (kèm câu giải thích nếu không có câu của hàng đối tác).
 * Báo giá chưa có `pointsMax` (đang tải, API cũ): không đổi gì.
 */
export function pointsCapState(
  quote: { pointsMax?: number; pointsPartnerNote?: string | null } | undefined,
  usable = 0,
): { disabled: boolean; capNote: string | null; partnerNote: string | null } {
  const partnerNote = quote?.pointsPartnerNote ?? null;
  if (!Number.isFinite(quote?.pointsMax)) return { disabled: partnerNote !== null, capNote: null, partnerNote };
  const max = clamp(quote!.pointsMax);
  if (max === 0) {
    if (partnerNote) return { disabled: true, capNote: null, partnerNote };
    return usable > 0
      ? { disabled: true, capNote: 'Đơn này chưa dùng được Điểm Xanh', partnerNote: null }
      : { disabled: false, capNote: null, partnerNote: null };
  }
  if (partnerNote) return { disabled: false, capNote: `Đơn này dùng tối đa ${group(max)} Điểm Xanh`, partnerNote };
  if (max < usable) {
    return { disabled: false, capNote: `Đơn này dùng tối đa ${group(max)} Điểm Xanh, tính theo giá trị hàng của đơn`, partnerNote: null };
  }
  return { disabled: false, capNote: null, partnerNote: null };
}

/**
 * Đơn 0đ (điểm hoặc mã giảm giá phủ hết cả hàng lẫn phí ship): BE ép COD và xác nhận luôn, không thu tiền,
 * nên màn thanh toán ẩn lựa chọn phương thức và nói rõ lý do. null = còn tiền cần trả.
 */
export function zeroTotalNote(q: { total: number; pointsDiscount: number }): string | null {
  if (q.total > 0) return null;
  return q.pointsDiscount > 0
    ? 'Đơn đã được trả đủ bằng Điểm Xanh. Bạn không cần thanh toán thêm.'
    : 'Đơn không còn số tiền cần thanh toán.';
}
