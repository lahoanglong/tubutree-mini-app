/**
 * Hoa hồng CTV đã duyệt (APPROVED) tự vào Ví Tubu sau mỗi lượt duyệt của cron, đi đúng đường "Chuyển vào Ví" (requestPayout). Mặc
 * định bật. Tắt: hoa hồng nằm ở "có thể chuyển" cho tới khi CTV tự bấm như trước. Chỉ đúng boolean `true` mới bật.
 */
export const AFFILIATE_AUTO_WALLET_TRANSFER_KEY = 'affiliate.auto_wallet_transfer_enabled';
export const DEFAULT_AFFILIATE_AUTO_WALLET_TRANSFER_ENABLED = true;
