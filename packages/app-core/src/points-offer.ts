import { formatVnNumber } from './number-format';
import { fillCopy } from './shop-copy';

/** Mặc định khi cấu hình chưa tải: 1 Điểm Xanh = 1đ khi trả đơn (loyalty.vnd_per_point_redeem). */
const DEFAULT_VND_PER_POINT = 1;

/**
 * Chữ của hàng Điểm Xanh một dòng (có công tắc) ở màn thanh toán: "Dùng 1.200 Điểm Xanh (-1.200đ)". Đã bật thì lấy số thật báo giá trừ
 * (`applied`); chưa bật thì ước theo số dùng được, kẹp theo trần của đơn (`pointsMax`); chưa có trần thì chỉ ghi số điểm dùng được, không hứa số tiền.
 */
export function pointsOfferText(
  usable: number,
  quote: { pointsMax?: number } | undefined,
  applied?: { pointsUsed: number; pointsDiscount: number } | null,
  vndPerPoint: number = DEFAULT_VND_PER_POINT,
): string {
  const line = (n: number, amount: number) => fillCopy('checkout.pointsToggle', { n: formatVnNumber(n), amount: `${formatVnNumber(amount)}đ` });
  if (applied) return line(applied.pointsUsed, applied.pointsDiscount);
  // Chưa có trần của đơn (chưa có địa chỉ, báo giá lỗi): số tiền giảm thật có thể thấp hơn số dư nhiều, không hứa số tiền.
  if (!Number.isFinite(quote?.pointsMax)) return fillCopy('checkout.pointsToggleNoAmount', { n: formatVnNumber(Math.max(0, usable)) });
  const points = Math.max(0, Math.min(usable, Math.max(0, quote!.pointsMax as number)));
  return line(points, points * (vndPerPoint > 0 ? vndPerPoint : DEFAULT_VND_PER_POINT));
}
