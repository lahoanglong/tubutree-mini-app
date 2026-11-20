/**
 * Loại gửi của từng mẫu thông báo, dùng cho trần tin chủ động ngoài app (cờ `notify.proactive_cap_enabled`).
 *
 * - TRANSACTIONAL: tin khách cần biết vì việc của chính họ (đơn hàng, thanh toán, đổi trả, hoàn tiền, đổi rác, điểm/tiền đã ghi sổ, bảo mật,
 *   tài khoản, việc của đối tác và vận hành). Không bao giờ bị trần.
 * - PROACTIVE: tin cửa hàng tự chủ động nhắc để khách quay lại. Kênh ngoài app (ZNS) chịu trần mỗi ngày/tuần; tin trong app luôn lưu.
 *
 * Loại gửi khác nhóm công tắc ở notification-categories.ts: công tắc là khách có muốn nhận nhóm tin đó không, loại gửi là tin có bị trần
 * số lượng không. Ví dụ RESTOCK_AVAILABLE khách tự bấm đăng ký nên không thuộc công tắc khuyến mãi, nhưng vẫn là tin chủ động.
 * Mã mới PHẢI được khai ở đây (notification-delivery.spec.ts đối chiếu với seed và với mã truyền vào notify()); mã lạ lúc chạy coi là
 * TRANSACTIONAL để không bao giờ chặn nhầm một tin quan trọng.
 */
export type NotificationDeliveryKind = 'TRANSACTIONAL' | 'PROACTIVE';

/** Nhóm ưu tiên của tin chủ động, theo thứ tự giành lượt khi trong ngày còn ít chỗ hơn số tin (đầu danh sách thắng). */
export const PROACTIVE_GROUPS = ['restock', 'cart', 'expiry', 'reorder', 'streak', 'promo', 'social'] as const;
export type ProactiveGroup = (typeof PROACTIVE_GROUPS)[number];

export type NotificationDelivery = { kind: 'TRANSACTIONAL' } | { kind: 'PROACTIVE'; group: ProactiveGroup };

const T: NotificationDelivery = { kind: 'TRANSACTIONAL' };
const P = (group: ProactiveGroup): NotificationDelivery => ({ kind: 'PROACTIVE', group });

export const NOTIFICATION_DELIVERY: Readonly<Record<string, NotificationDelivery>> = {
  // Đơn hàng, thanh toán, hoá đơn
  ORDER_CONFIRMED: T,
  ORDER_SHIPPING: T,
  ORDER_DELIVERED: T,
  ORDER_CANCELLED: T,
  ORDER_PACKED: T,
  ORDER_RETURNED: T,
  ORDER_AWAITING_PAYMENT: T,
  ORDER_PAYMENT_EXPIRED: T,
  ORDER_UNDERPAID: T,
  ORDER_MERCHANT_DELAYED: T,
  INVOICE_ISSUED: T,
  SUBSCRIPTION_ORDER: T,
  SUBSCRIPTION_PAUSED: T,
  SUBSCRIPTION_ORDER_AWAITING_PAYMENT: T,
  SUBSCRIPTION_ORDER_FAILED: T,
  GROUP_BUY_SUCCESS: T,
  GROUP_BUY_FAILED: T,
  // Đổi trả, hoàn tiền
  RETURN_REQUESTED: T,
  RETURN_APPROVED: T,
  RETURN_APPROVED_NO_REFUND: T,
  RETURN_APPROVED_POINTS: T,
  RETURN_APPROVED_WALLET_POINTS: T,
  RETURN_APPROVED_DETAIL: T,
  RETURN_REJECTED: T,
  RETURN_RECEIVED: T,
  REFUND_BANK_REQUESTED: T,
  REFUND_BANK_COMPLETED: T,
  REFUND_LATE_PAYMENT: T,
  REFUND_OVERPAYMENT: T,
  REFUND_WALLET_CREDITED: T,
  // Đổi rác
  WASTE_PARCEL_RECEIVED: T,
  WASTE_POINTS_CREDITED: T,
  WASTE_REQUEST_REJECTED: T,
  WASTE_REQUEST_EXPIRED: T,
  WASTE_PICKUP_STARTED: T,
  WASTE_PICKUP_CANCELLED: T,
  WASTE_POINTS_REVERSED: T,
  WASTE_SHIP_LOCKED: T,
  WASTE_GIFT_CANCELLED: T,
  WASTE_PERK_REVIEWED: T,
  WASTE_GIFT_EXPIRED: T,
  WASTE_REQUEST_EXPIRING: T,
  // Điểm, tiền, phần thưởng khách đã kiếm (đã ghi sổ hoặc vừa bị thu hồi)
  CASHBACK_PAID: T,
  MILESTONE_VOUCHER: T,
  REFERRAL_REWARD_PAID: T,
  REFERRAL_MILESTONE_PAID: T,
  REFERRAL_REWARD_REVOKED: T,
  EXTERNAL_POINTS_PENDING: T,
  EXTERNAL_POINTS_CREDITED: T,
  EXTERNAL_POINTS_VOIDED: T,
  EXTERNAL_POINTS_CLAIM_NOT_FOUND: T,
  CHAT_ORDER_POINTS_CREDITED: T,
  CHAT_ORDER_POINTS_LINKED: T,
  XU_CONVERTED: T,
  TIER_UPGRADED: T,
  COMMUNITY_EVENT_WINNER: T,
  // Tài khoản, bảo mật, hỗ trợ, kiểm duyệt nội dung của chính khách
  ACCOUNT_DELETION_REQUESTED: T,
  SUPPORT_CHAT_REPLY: T,
  COMMUNITY_POST_APPROVED: T,
  COMMUNITY_POST_REJECTED: T,
  COMMUNITY_POST_HIDDEN: T,
  // Đối tác: CTV, đại lý, người bán, gian hàng
  COMMISSION_NEW: T,
  COMMISSION_APPROVED: T,
  COMMISSION_WALLET_CREDITED: T,
  COMMISSION_WALLET_TAX_ONLY: T,
  COMMISSION_PAYOUT_PAID: T,
  COMMISSION_PAYOUT_APPROVED: T,
  COMMISSION_PAYOUT_REJECTED: T,
  COMMISSION_REVERSED: T,
  COMMISSION_MILESTONE_REVOKED: T,
  COMMISSION_TAX_ID_NEEDED: T,
  DEALER_BONUS_PAID: T,
  DEALER_REWARD_CLAIM_NEW: T,
  DEALER_REWARD_CLAIM_APPROVED: T,
  DEALER_REWARD_CLAIM_REJECTED: T,
  DEALER_REWARD_CLAIM_PAID: T,
  DEALER_BONUS_ADJUSTED: T,
  DEALER_BONUS_TOPUP: T,
  DEALER_CREDIT_PAYMENT_REPORTED: T,
  DEALER_CREDIT_PAYMENT_CONFIRMED: T,
  DEALER_CREDIT_PAYMENT_CONFIRMED_DISCOUNT: T,
  DEALER_APPLICATION_APPROVED: T,
  DEALER_APPLICATION_REJECTED: T,
  MERCHANT_ORDER_NEW: T,
  MERCHANT_RETURN_APPROVED: T,
  MERCHANT_ORDER_CANCELLED: T,
  MERCHANT_ORDER_OVERDUE: T,
  MERCHANT_ORDER_CANCELLED_BY_SELLER: T,
  MERCHANT_PAYOUT_CREATED: T,
  MERCHANT_PAYOUT_PAID: T,
  MERCHANT_PAYOUT_CREATED_TO_TUBU: T,
  MERCHANT_PAYOUT_CANCELLED: T,
  MERCHANT_PAYOUT_CANCELLED_TO_TUBU: T,
  MERCHANT_RETURN_REQUESTED: T,
  MERCHANT_PRODUCT_UNLINKED: T,
  MERCHANT_PRODUCT_APPROVED: T,
  MERCHANT_PRODUCT_REJECTED: T,
  MERCHANT_PRODUCT_EDIT_APPROVED: T,
  MERCHANT_PRODUCT_EDIT_REJECTED: T,
  STOREFRONT_TAKEN_DOWN: T,
  STOREFRONT_REINSTATED: T,
  STOREFRONT_APPROVED: T,
  // Vận hành (chỉ gửi tài khoản quản trị)
  OPS_GOMDON_ALERT: T,
  OPS_HEALTH_ALERT: T,
  OPS_PANCAKE_ALERT: T,
  OPS_REFUND_ALERT: T,
  OPS_PAYMENT_ALERT: T,
  OPS_ZALO_BRIDGE_DOWN: T,
  OPS_ZALO_BRIDGE_ALERT: T,
  OPS_CRON_FAILED: T,
  OPS_MERCHANT_PRODUCT_PENDING: T,
  OPS_MERCHANT_PRODUCT_EDIT_PENDING: T,
  OPS_DEALER_APPLICATION_PENDING: T,

  // Tin chủ động. Hàng về và "Nhắc tôi" giờ vàng: khách tự đăng ký nên được ưu tiên nhất.
  RESTOCK_AVAILABLE: P('restock'),
  FLASH_STARTING: P('restock'),
  CART_ABANDONED: P('cart'),
  POINTS_EXPIRING: P('expiry'),
  VOUCHER_EXPIRING: P('expiry'),
  TIER_DROP_NOTICE: P('expiry'),
  REORDER_REMINDER: P('reorder'),
  REORDER_REMINDER_REFILL: P('reorder'),
  GAME_CHECKIN_REMINDER: P('streak'),
  GAME_TREE_THIRSTY: P('streak'),
  WELCOME_VOUCHER: P('promo'),
  BIRTHDAY_VOUCHER: P('promo'),
  WINBACK_VOUCHER: P('promo'),
  SECOND_ORDER_VOUCHER: P('promo'),
  PRICE_DROP_ALERT: P('promo'),
  STOREFRONT_TRENDING_PRODUCTS: P('promo'),
  REVIEW_REQUEST: P('promo'),
  COMMUNITY_POST_LIKED: P('social'),
  COMMUNITY_POST_COMMENTED: P('social'),
  COMMUNITY_NEW_ANSWER: P('social'),
  COMMUNITY_EXPERT_REPLIED: P('social'),
  COMMUNITY_BEST_ANSWER: P('social'),
  GAME_WATER_GIFT: P('social'),
};

export function notificationDelivery(templateCode: string): NotificationDelivery {
  return NOTIFICATION_DELIVERY[templateCode] ?? T;
}

/** Số nhỏ thắng: hàng về 0, ..., tương tác 6. */
export function proactivePriority(group: ProactiveGroup): number {
  return PROACTIVE_GROUPS.indexOf(group);
}
