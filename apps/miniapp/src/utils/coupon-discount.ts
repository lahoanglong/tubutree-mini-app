import type { CouponDTO } from '../services/account-api';

/** Số tiền mã PERCENT/AMOUNT giảm cho tạm tính này — cùng công thức CouponsService.evaluate ở API. FREESHIP (giảm ở phí ship) trả 0. */
export function couponDiscountFor(coupon: Pick<CouponDTO, 'type' | 'value' | 'maxDiscount'>, subtotal: number): number {
  if (subtotal <= 0) return 0;
  if (coupon.type === 'PERCENT') {
    const d = Math.min(Math.floor((subtotal * coupon.value) / 100), subtotal);
    return coupon.maxDiscount ? Math.min(d, coupon.maxDiscount) : d;
  }
  if (coupon.type === 'AMOUNT') return Math.min(coupon.value, subtotal);
  return 0;
}
