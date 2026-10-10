/**
 * Nhóm tin theo công tắc ở trang Cài đặt của khách.
 * PROMO = tin tiếp thị (khách tắt "Khuyến mãi & mã giảm giá" thì không nhận, cả trong app lẫn ZNS);
 * GARDEN = nhắc nhở Vườn Xanh; còn lại là tin giao dịch/tài khoản, luôn gửi.
 * Mã mới chưa liệt kê rơi vào TRANSACTIONAL, nên tin tiếp thị mới PHẢI được thêm vào đây.
 */
export type NotificationCategory = 'PROMO' | 'GARDEN' | 'TRANSACTIONAL';

const PROMO_CODES = new Set([
  'CART_ABANDONED',
  'PRICE_DROP_ALERT',
  'FLASH_STARTING',
  'VOUCHER_EXPIRING',
  'WELCOME_VOUCHER',
  'BIRTHDAY_VOUCHER',
  'WINBACK_VOUCHER',
  'MILESTONE_VOUCHER',
  'REORDER_REMINDER',
  'STOREFRONT_TRENDING_PRODUCTS',
]);

const GARDEN_CODES = new Set(['GAME_CHECKIN_REMINDER', 'GAME_TREE_THIRSTY']);

export function notificationCategory(templateCode: string): NotificationCategory {
  if (PROMO_CODES.has(templateCode)) return 'PROMO';
  if (GARDEN_CODES.has(templateCode)) return 'GARDEN';
  return 'TRANSACTIONAL';
}

export interface NotificationPrefs {
  notifyPromo: boolean;
  notifyGarden: boolean;
}

/** Không có user (hoặc thiếu cột) thì coi như không đồng ý nhận tin tiếp thị. */
export function isAllowedByPrefs(templateCode: string, user: Partial<NotificationPrefs> | null): boolean {
  const category = notificationCategory(templateCode);
  if (category === 'PROMO') return user?.notifyPromo === true;
  if (category === 'GARDEN') return user?.notifyGarden === true;
  return true;
}
