/**
 * Cờ ẩn lối vào theo quyết định chủ dự án (Q-15, Q-16). Trang, route và API giữ nguyên để bật lại bằng
 * cách đổi cờ ở đây, không phải dựng lại.
 */

/** Chặng Mùa: mùa duy nhất đã hết hạn 31/08 và chưa có công cụ tạo mùa. */
export const SEASON_PASS_ENABLED = false;

/** Giao định kỳ trong Mini App: chủ chốt tạm ẩn đợt đầu (28/10). Chỉ ẩn lối vào ở Mini App, web giữ nguyên. */
export const SUBSCRIPTIONS_IN_MINIAPP = false;

/** Hoàn tiền sàn ngoài (AccessTrade): chưa có key, kéo khách sang sàn khác, ngược north-star mua lại. */
export const CASHBACK_ENABLED = false;
