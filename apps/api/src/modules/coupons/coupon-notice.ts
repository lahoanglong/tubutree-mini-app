import type { BadRequestException } from '@nestjs/common';
import { CouponProductScopeError } from './coupons.service';

/** Lý do khi mã vẫn hợp lệ nhưng phần hàng được tính giảm ra 0đ (vd giỏ toàn hàng giờ vàng, mã không có đơn tối thiểu). */
export const COUPON_ZERO_DISCOUNT_REASON = 'Không có sản phẩm nào trong đơn được giảm theo mã này.';

/** Mã miễn phí vận chuyển chỉ miễn phí giao hàng do Tubu Tree giao; đơn chỉ có hàng gian hàng tự giao, hoặc đã miễn phí giao. */
export const COUPON_FREESHIP_NOTHING_REASON =
  'Mã miễn phí vận chuyển chỉ áp cho phí giao hàng do Tubu Tree giao, và đơn này không có phí giao đó.';

/** Đơn đầu đã được miễn phí giao nên mã freeship không miễn thêm gì và không bị tiêu lượt. */
export const COUPON_FREESHIP_FIRST_ORDER_REASON = 'Đơn đầu đã được miễn phí giao, mã FREESHIP được giữ cho đơn sau.';

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

/** Mã gắn sản phẩm mà sản phẩm đó chỉ có trong giỏ ở giá giờ vàng. */
export const COUPON_PRODUCT_FLASH_REASON =
  'Sản phẩm áp dụng mã đang có giá giờ vàng. Giá giờ vàng là giá ưu đãi cuối nên không giảm thêm theo mã, bạn dùng được mã này khi giờ vàng kết thúc.';

/**
 * Câu lý do mã bị từ chối để báo khách: mã gắn sản phẩm mà sản phẩm đó có trong giỏ nhưng chỉ ở giá giờ vàng (dòng giờ vàng bị
 * loại khỏi phần xét mã) thì nói đúng là đang giờ vàng, không nói "giỏ chưa có sản phẩm đó". Lỗi khác giữ nguyên thông điệp.
 */
export function couponRejectReason(err: BadRequestException, lines: { productId: string; isFlash: boolean }[]): string {
  if (err instanceof CouponProductScopeError && lines.some((l) => l.isFlash && err.productIds.includes(l.productId))) {
    return COUPON_PRODUCT_FLASH_REASON;
  }
  return err.message;
}
