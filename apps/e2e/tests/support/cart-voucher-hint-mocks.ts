import type { MockApi } from './mock-api';

/**
 * Ví mã + xem trước từng mã cho gợi ý mã giảm giá ở Giỏ (W44B), dùng chung cho Mini App và web để hai bên đo cùng một bộ số.
 * Giỏ thử có tạm tính 90.000đ: GIAM20 không đòi đơn tối thiểu nên đủ điều kiện ngay (giảm 20.000đ); GIAM80 đòi 120.000đ nên còn thiếu 30.000đ
 * (số `shortfall` do máy chủ giả trả, đúng như máy chủ thật đã loại dòng Giờ vàng).
 */
export const APPLY_CODE = 'GIAM20';
export const UNLOCK_CODE = 'GIAM80';
export const APPLY_DISCOUNT = 20_000;
export const UNLOCK_MIN_ORDER = 120_000;
export const UNLOCK_SHORTFALL = 30_000;

export type HintWallet = 'both' | 'apply' | 'unlock';

const endAt = () => new Date(Date.now() + 5 * 86_400_000).toISOString();

const applyCoupon = () => ({ code: APPLY_CODE, type: 'AMOUNT' as const, value: APPLY_DISCOUNT, minOrder: null, maxDiscount: null, endAt: endAt() });
const unlockCoupon = () => ({ code: UNLOCK_CODE, type: 'AMOUNT' as const, value: 80_000, minOrder: UNLOCK_MIN_ORDER, maxDiscount: null, endAt: endAt() });

export function hintWallet(which: HintWallet = 'both') {
  return [...(which === 'unlock' ? [] : [applyCoupon()]), ...(which === 'apply' ? [] : [unlockCoupon()])];
}

export function hintPreviews(which: HintWallet = 'both') {
  return [
    ...(which === 'unlock' ? [] : [{ code: APPLY_CODE, eligible: true, discount: APPLY_DISCOUNT }]),
    ...(which === 'apply'
      ? []
      : [{ code: UNLOCK_CODE, eligible: false, discount: 0, reason: 'Đơn tối thiểu 120.000đ để dùng mã này.', shortfall: UNLOCK_SHORTFALL }]),
  ];
}

export function mockVoucherHint(api: MockApi, which: HintWallet = 'both'): void {
  api.get('/me/coupons', hintWallet(which));
  api.post('/checkout/coupon-previews', { coupons: hintPreviews(which) });
}
