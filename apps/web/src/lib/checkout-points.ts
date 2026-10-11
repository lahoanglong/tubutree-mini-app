const clamp = (n: number | undefined) => (Number.isFinite(n) ? Math.max(0, n as number) : 0);
const group = (n: number) => n.toLocaleString('vi-VN');

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
    convertedNote: converted > 0 ? `trong đó ${group(converted)} điểm không hết hạn` : null,
  };
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
): { usable: number; lockNote: string | null; convertedNote: string | null } {
  if (!quote) return { usable: 0, lockNote: null, convertedNote: null };
  const balance = clamp(quote.pointsBalance);
  const standardUsable = Math.min(balance, clamp(quote.redeemablePoints ?? balance));
  const held = balance - standardUsable;
  const converted = clamp(quote.redeemableConvertedPoints ?? quote.pointsConvertedBalance);
  return {
    usable: standardUsable + converted,
    lockNote: held > 0 ? `${held} điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được` : null,
    convertedNote: converted > 0 ? `trong đó ${group(converted)} điểm không hết hạn, trả tới 100% giá trị hàng` : null,
  };
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
