/** Khoá và mặc định tỉ lệ tích Điểm Xanh (phần trăm tiền hàng sau giảm giá, không gồm ship; 2 = 2%), trước hệ số hạng. */
export const EARN_PCT_KEY = 'loyalty.earn_pct';
export const DEFAULT_EARN_PCT = 2;

/**
 * Tỉ lệ cho đơn mua qua sàn ngoài (claim SCAN, external-claim.config.ts), cùng đơn vị với loyalty.earn_pct: 5 = 5% tiền hàng, 1 điểm = 1đ
 * khi tiêu (loyalty.vnd_per_point_redeem khoá ở 1). Mặc định trong mã chỉ dùng khi DB chưa có dòng; PROD đặt qua Admin.
 */
export const MARKETPLACE_EARN_PCT_KEY = 'loyalty.marketplace_earn_pct';
export const DEFAULT_MARKETPLACE_EARN_PCT = 5;
/** Trần tỉ lệ đơn sàn: phía cộng điểm và config công khai cùng kẹp về mức này, để miniapp hứa đúng số server tính. */
export const MAX_MARKETPLACE_EARN_PCT = 20;
