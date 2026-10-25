/**
 * Tên sự kiện analytics. Hai nhóm tách bạch: client được phép gửi qua POST /events, còn sự kiện
 * do server phát (gắn với tiền/đơn/trạng thái) thì client KHÔNG được ghi — nếu không, ai cũng có
 * thể bơm order_paid giả làm sai phễu và doanh thu trong báo cáo.
 */
export const CLIENT_EVENT_NAMES = [
  'app_opened',
  'screen_viewed',
  'client_error',
  'product_viewed',
  'checkout_started',
  'notification_opened',
  'reorder_clicked',
  'reorder_completed',
  'reorder_reminder_cta',
  'search_performed',
  'search_result_clicked',
  'filter_applied',
  'ext_claim_scan',
  'ext_claim_phone',
  'oa_follow_result',
] as const;

export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

export const SERVER_EVENT_NAMES = [
  'add_to_cart',
  'coupon_applied',
  'engagement_action',
  'ext_claim_credited',
  'ext_claim_submitted',
  'notification_sent',
  'order_paid',
  'order_place_failed',
  'order_placed',
  'order_status_changed',
  'referral_touched',
  'subscription_changed',
] as const;

export type ServerEventName = (typeof SERVER_EVENT_NAMES)[number];
