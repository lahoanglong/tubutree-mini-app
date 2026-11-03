/**
 * Mã và khoá cấu hình của tin báo sắp rớt hạng, tách khỏi tier-drop-notice.service để màn Mẫu thông báo đọc được mà không kéo
 * NotificationsService vào vòng import (notifications.service → notification-templates-admin.service → service này → notifications.service).
 */
export const TIER_DROP_NOTICE_CODE = 'TIER_DROP_NOTICE';
/** Mã mẫu ZNS Zalo đã duyệt cho tin này (biến tier, date, need). Trống = chỉ báo trong app. */
export const TIER_DROP_ZNS_TEMPLATE_KEY = 'loyalty.tier_drop_zns_template_id';
