import { formatVnNumber } from './number-format';

/** Mặc định khi cấu hình chưa tải: 1 Điểm Xanh = 1đ khi trả đơn (loyalty.vnd_per_point_redeem). */
const DEFAULT_VND_PER_POINT = 1;

/**
 * Dòng phụ của ô Điểm Xanh ở màn thanh toán: "Dùng 1.200 điểm, giảm 1.200đ". Đã bật thì lấy số thật báo giá trừ
 * (`applied`); chưa bật thì ước theo số dùng được, kẹp theo trần của đơn (`pointsMax`); chưa có trần thì chỉ ghi số điểm dùng được.
 */
export function pointsOfferText(
  usable: number,
  quote: { pointsMax?: number } | undefined,
  applied?: { pointsUsed: number; pointsDiscount: number } | null,
  vndPerPoint: number = DEFAULT_VND_PER_POINT,
): string {
  if (applied) return `Dùng ${formatVnNumber(applied.pointsUsed)} điểm, giảm ${formatVnNumber(applied.pointsDiscount)}đ`;
  // Chưa có trần của đơn (chưa có địa chỉ, báo giá lỗi): số tiền giảm thật có thể thấp hơn số dư nhiều, không hứa số tiền.
  if (!Number.isFinite(quote?.pointsMax)) return `Dùng được ${formatVnNumber(Math.max(0, usable))} điểm`;
  const points = Math.max(0, Math.min(usable, Math.max(0, quote!.pointsMax as number)));
  return `Dùng ${formatVnNumber(points)} điểm, giảm ${formatVnNumber(points * (vndPerPoint > 0 ? vndPerPoint : DEFAULT_VND_PER_POINT))}đ`;
}
