/**
 * Câu giải thích cho khách khi giỏ vẫn giữ mã nhưng mã chưa được áp cho đơn này (giảm 0đ, không tiêu
 * lượt). `reason` là thông điệp tiếng Việt của CouponsService (vd "Đơn tối thiểu 150.000đ để dùng mã này.").
 */
export function couponNotAppliedNotice(reason: string, hasFlash: boolean, hasCombo = false): string {
  const excluded = [hasFlash ? 'hàng giờ vàng' : null, hasCombo ? 'phần giảm combo' : null].filter(Boolean);
  const why = excluded.length > 0 ? ` (${excluded.join(' và ')} không được tính vào điều kiện của mã)` : '';
  return `Mã chưa được áp dụng cho đơn này${why}: ${reason}`;
}
