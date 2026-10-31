/**
 * Cờ ẩn lối vào theo quyết định chủ dự án (Q-15, Q-16). Trang, route và API giữ nguyên để bật lại bằng
 * cách đổi cờ ở đây, không phải dựng lại.
 */

/** Chặng Mùa chưa bật theo quyết định của chủ. Muốn bật: đổi cờ này thành true và tạo mùa ở quản trị. */
export const SEASON_PASS_ENABLED = false;

/**
 * Vườn Xanh trên web còn tab Cộng đồng (tặng nước bạn bè, bảng xếp hạng người chơi) mà Mini App đã bỏ theo chính sách Zalo 4.6. Web khổ điện thoại
 * phải giống Mini App nên tab ẩn; mã giữ nguyên, đổi sang true là tab hiện lại như cũ.
 */
export const GAME_SOCIAL_ON_WEB = false;

/** Giao định kỳ trong Mini App: chủ chốt tạm ẩn đợt đầu (28/10). Chỉ ẩn lối vào ở Mini App, web giữ nguyên. */
export const SUBSCRIPTIONS_IN_MINIAPP = false;

/** Hoàn tiền sàn ngoài (AccessTrade): chưa có key, kéo khách sang sàn khác, ngược north-star mua lại. */
export const CASHBACK_ENABLED = false;
