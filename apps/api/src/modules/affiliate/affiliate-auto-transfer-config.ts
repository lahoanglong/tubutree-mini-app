/**
 * Hoa hồng CTV đã duyệt (APPROVED) tự vào Ví Tubu sau mỗi lượt duyệt của cron, đi đúng đường "Chuyển vào Ví" (requestPayout). Mặc
 * định bật. Tắt: hoa hồng nằm ở "có thể chuyển" cho tới khi CTV tự bấm như trước. Chỉ đúng boolean `true` mới bật.
 */
export const AFFILIATE_AUTO_WALLET_TRANSFER_KEY = 'affiliate.auto_wallet_transfer_enabled';
export const DEFAULT_AFFILIATE_AUTO_WALLET_TRANSFER_ENABLED = true;

/** Duyệt hoa hồng đủ hạn mỗi giờ (approvedAt là mốc doanh số tháng nên không dời giờ). */
export const APPROVE_COMMISSIONS_CRON = '0 0 * * * *';
/** Từ giờ này (giờ VN) mỗi ngày, lượt chuyển vào Ví và tin tổng chạy một lần; lỡ thì chạy bù ở giờ sau. */
export const DAILY_WALLET_TRANSFER_HOUR_VN = 8;
/** Dòng cron_runs ghi mốc lượt ngày gần nhất xong. */
export const DAILY_WALLET_TRANSFER_JOB = 'AffiliateService.dailyWalletTransfer';
