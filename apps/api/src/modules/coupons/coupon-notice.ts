/** Lý do khi mã vẫn hợp lệ nhưng phần hàng được tính giảm ra 0đ (vd giỏ toàn hàng giờ vàng, mã không có đơn tối thiểu). */
export const COUPON_ZERO_DISCOUNT_REASON = 'Không có sản phẩm nào trong đơn được giảm theo mã này.';

/** Mã miễn phí vận chuyển chỉ miễn phí giao hàng do Tubu Tree giao; đơn chỉ có hàng gian hàng tự giao, hoặc đã miễn phí giao. */
export const COUPON_FREESHIP_NOTHING_REASON =
  'Mã miễn phí vận chuyển chỉ áp cho phí giao hàng do Tubu Tree giao, và đơn này không có phí giao đó.';

/**
 * Câu giải thích cho khách khi giỏ vẫn giữ mã nhưng mã chưa được áp cho đơn này (giảm 0đ, không tiêu
 * lượt). `reason` là thông điệp tiếng Việt của CouponsService (vd "Đơn tối thiểu 150.000đ để dùng mã này.").
 */
export function couponNotAppliedNotice(reason: string, hasFlash: boolean, hasCombo = false): string {
  const excluded = [hasFlash ? 'hàng giờ vàng' : null, hasCombo ? 'phần giảm combo' : null].filter(Boolean);
  const why = excluded.length > 0 ? ` (${excluded.join(' và ')} không được tính vào điều kiện của mã)` : '';
  return `Mã chưa được áp dụng cho đơn này${why}: ${reason}`;
}

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

/** Mã đã áp nhưng giỏ có hàng giờ vàng: giá giờ vàng là giá cuối nên mã chỉ giảm trên phần hàng còn lại. */
export function couponFlashExcludedNotice(base: number): string {
  return `Hàng giờ vàng không được giảm thêm theo mã: mã chỉ tính trên ${vnd(base)} hàng còn lại.`;
}

/** Lỗi áp mã khi giỏ có hàng giờ vàng: nói thêm hàng giờ vàng không được tính vào điều kiện của mã. */
export function couponRejectedWithFlash(reason: string, base: number): string {
  return `${reason} Hàng giờ vàng không được tính vào điều kiện của mã, phần được tính là ${vnd(base)}.`;
}
