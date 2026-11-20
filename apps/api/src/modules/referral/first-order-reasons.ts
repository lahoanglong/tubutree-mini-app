/**
 * Tiền tố reason của thưởng đơn đầu (first-order-reward.ts). Tách riêng để loyalty-expiry.service (ghép lô thưởng với dòng thu hồi) dùng được
 * mà first-order-reward.ts vẫn import lotRecoverable từ đó, không thành vòng import.
 */
export const FIRST_ORDER_REFERRER_PREFIX = 'REFERRAL_FIRST_ORDER_REFERRER:';
export const FIRST_ORDER_REFEREE_PREFIX = 'REFERRAL_FIRST_ORDER_REFEREE:';
/**
 * Dòng thu hồi khi gộp: `REFERRAL_FIRST_ORDER_REVOKE:<REFERRER|REFEREE>:<id người được mời>`. Không mở đầu bằng hai tiền tố thưởng ở trên,
 * nên không bị đếm là một lần thưởng (trần tháng, Trung tâm tăng trưởng); loyalty-expiry ghép nó với lô thưởng cùng phía.
 */
export const FIRST_ORDER_REVOKE_PREFIX = 'REFERRAL_FIRST_ORDER_REVOKE:';
/** Phần không trừ được vì số dư không đủ: dòng delta 0 refType REFERRAL_DEBT, `REFERRAL_FIRST_ORDER_DEBT:<phía>:<id>:<số điểm thiếu>`. */
export const FIRST_ORDER_DEBT_PREFIX = 'REFERRAL_FIRST_ORDER_DEBT:';
