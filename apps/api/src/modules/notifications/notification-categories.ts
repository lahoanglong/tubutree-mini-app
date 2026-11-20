/**
 * Nhóm tin theo công tắc ở trang Cài đặt của khách.
 * PROMO = tin tiếp thị (khách tắt "Khuyến mãi & mã giảm giá" thì không nhận, cả trong app lẫn ZNS);
 * GARDEN = nhắc nhở Vườn Xanh, quà nước của bạn bè và tin "bài của bạn có người thích/bình luận/trả lời" (cùng một loại: tin kéo khách quay lại, khách tắt được); còn lại là tin giao dịch/tài khoản, luôn gửi.
 * Trong GARDEN, tin tương tác bài viết (SOCIAL_CODES) đi theo công tắc riêng `notifySocial` từ wave tubu-notify-cap-restock; thiếu cột (dữ liệu
 * cũ, đối tượng dựng tay) thì theo `notifyGarden` như công tắc gộp trước đây.
 * Mã mới chưa liệt kê rơi vào TRANSACTIONAL, nên tin tiếp thị mới PHẢI được thêm vào đây.
 * Cố ý KHÔNG xếp PROMO: FLASH_STARTING (khách tự bấm "Nhắc tôi", cron đã đánh dấu notifiedAt trước khi
 * gửi nên chặn ở đây là mất nhắc vĩnh viễn) và MILESTONE_VOUCHER (thưởng khách tự kiếm qua giới thiệu,
 * mã vẫn được phát nên khách phải được báo).
 */
export type NotificationCategory = 'PROMO' | 'GARDEN' | 'TRANSACTIONAL';

const PROMO_CODES = new Set([
  'CART_ABANDONED',
  'PRICE_DROP_ALERT',
  'VOUCHER_EXPIRING',
  'WELCOME_VOUCHER',
  'BIRTHDAY_VOUCHER',
  'WINBACK_VOUCHER',
  'SECOND_ORDER_VOUCHER',
  'REORDER_REMINDER',
  'REORDER_REMINDER_REFILL',
  'STOREFRONT_TRENDING_PRODUCTS',
]);

const GARDEN_CODES = new Set([
  'GAME_CHECKIN_REMINDER',
  'GAME_TREE_THIRSTY',
  'GAME_WATER_GIFT',
  'COMMUNITY_POST_LIKED',
  'COMMUNITY_POST_COMMENTED',
  'COMMUNITY_NEW_ANSWER',
]);

/** Tin "bài của bạn có người thích, bình luận, trả lời": công tắc "Tương tác bài viết" (`notifySocial`), tách khỏi "Nhắc Vườn Xanh". */
const SOCIAL_CODES = new Set(['COMMUNITY_POST_LIKED', 'COMMUNITY_POST_COMMENTED', 'COMMUNITY_NEW_ANSWER']);

export function isSocialCode(templateCode: string): boolean {
  return SOCIAL_CODES.has(templateCode);
}

export function notificationCategory(templateCode: string): NotificationCategory {
  if (PROMO_CODES.has(templateCode)) return 'PROMO';
  if (GARDEN_CODES.has(templateCode)) return 'GARDEN';
  return 'TRANSACTIONAL';
}

export interface NotificationPrefs {
  notifyPromo: boolean;
  notifyGarden: boolean;
  notifySocial: boolean;
}

/** Không có user (hoặc thiếu cột) thì coi như không đồng ý nhận tin tiếp thị. */
export function isAllowedByPrefs(templateCode: string, user: Partial<NotificationPrefs> | null): boolean {
  const category = notificationCategory(templateCode);
  if (category === 'PROMO') return user?.notifyPromo === true;
  if (category === 'GARDEN') return (SOCIAL_CODES.has(templateCode) ? (user?.notifySocial ?? user?.notifyGarden) : user?.notifyGarden) === true;
  return true;
}
