import { formatVnNumber } from './number-format';

/** 1 Điểm Xanh = 1đ khi trả đơn (luật loyalty). */
const VND_PER_POINT = 1;

/**
 * Dòng phụ của ô Điểm Xanh ở màn thanh toán: "Dùng 1.200 điểm, giảm 1.200đ". Đã bật thì lấy số thật báo giá trừ
 * (`applied`); chưa bật thì ước theo số dùng được, kẹp theo trần của đơn (`pointsMax`) khi báo giá đã có.
 */
export function pointsOfferText(
  usable: number,
  quote: { pointsMax?: number } | undefined,
  applied?: { pointsUsed: number; pointsDiscount: number } | null,
): string {
  if (applied) return `Dùng ${formatVnNumber(applied.pointsUsed)} điểm, giảm ${formatVnNumber(applied.pointsDiscount)}đ`;
  const cap = Number.isFinite(quote?.pointsMax) ? Math.max(0, quote!.pointsMax as number) : usable;
  const points = Math.max(0, Math.min(usable, cap));
  return `Dùng ${formatVnNumber(points)} điểm, giảm ${formatVnNumber(points * VND_PER_POINT)}đ`;
}
