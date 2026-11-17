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
  'recycle_funnel_step',
  'home_block_viewed',
  'product_card_click',
  'pdp_action',
  'cart_viewed',
  'checkout_step',
  'checkout_abandoned',
  'login_wall_shown',
  'login_started',
  'login_completed',
  'review_started',
  'review_submitted',
  'return_requested',
  'order_zalo_consent_shown',
  'order_zalo_consent_checked',
  'order_zalo_friend_click',
] as const;

export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

/** Nơi khách bấm "Mở Zalo Tubu Tree" (`order_zalo_friend_click.from`). */
export const ORDER_ZALO_FRIEND_FROM = ['success', 'order_detail'] as const;
export type OrderZaloFriendFrom = (typeof ORDER_ZALO_FRIEND_FROM)[number];

/** Nút bấm trên trang sản phẩm được đếm trong phễu mua (`pdp_action.action`). */
export const PDP_ACTIONS = ['add_to_cart', 'buy_now', 'open_variant_sheet', 'wishlist_add', 'share', 'video_play'] as const;
export type PdpAction = (typeof PDP_ACTIONS)[number];

/** Bước trong màn thanh toán (`checkout_step.step`); `checkout_abandoned.lastStep` thêm `started` cho khách rời đi trước bước đầu. */
export const CHECKOUT_STEPS = ['address_saved', 'shipping_quote_shown', 'payment_method_selected', 'place_order_click'] as const;
export type CheckoutStep = (typeof CHECKOUT_STEPS)[number];
export const CHECKOUT_LAST_STEPS = ['started', ...CHECKOUT_STEPS] as const;
export type CheckoutLastStep = (typeof CHECKOUT_LAST_STEPS)[number];

/**
 * Khách vào thanh toán từ đâu (`checkout_started.entry`): cả giỏ, một phần giỏ (đã bỏ chọn vài món), "Mua ngay" ở trang sản phẩm,
 * nút mua ở Giờ vàng. `unknown` khi tải lại thẳng trang thanh toán nên không còn dấu nơi bấm.
 */
export const CHECKOUT_ENTRIES = ['cart', 'cart_subset', 'buy_now', 'flash', 'unknown'] as const;
export type CheckoutEntry = (typeof CHECKOUT_ENTRIES)[number];

/** Nhóm tiền hàng của giỏ (`cart_viewed.subtotalBucket`): báo cáo không cần số tiền thật. */
export const SUBTOTAL_BUCKETS = ['0-99k', '100-199k', '200-499k', '500k+'] as const;
export type SubtotalBucket = (typeof SUBTOTAL_BUCKETS)[number];

export function subtotalBucket(vnd: number): SubtotalBucket {
  if (!(vnd >= 100_000)) return '0-99k';
  if (vnd < 200_000) return '100-199k';
  if (vnd < 500_000) return '200-499k';
  return '500k+';
}

/**
 * Đổi đường dẫn thật thành mẫu route (`/san-pham/nuoc-rua-chen-x` thành `/san-pham/:slug`) để sự kiện không mang tham số thật (mã đơn, slug, id).
 * `patterns` là các route động của nền tảng (`/san-pham/:slug`), so từng đoạn; nhiều mẫu khớp thì lấy mẫu có nhiều đoạn cố định nhất.
 * Không khớp mẫu nào thì giữ đoạn đúng khuôn route tĩnh (chữ thường, số, gạch nối) và thay đoạn khác bằng `:x`, tối đa 6 đoạn.
 */
export function toRouteTemplate(pathname: string, patterns: readonly string[]): string {
  const path = (pathname.split(/[?#]/)[0] ?? '').replace(/\/+$/, '') || '/';
  if (path === '/') return '/';
  const segs = path.split('/').slice(1);
  let best: string | null = null;
  let bestFixed = -1;
  for (const p of patterns) {
    const ps = p.split('/').slice(1);
    if (ps.length !== segs.length) continue;
    let fixed = 0;
    let ok = true;
    for (let i = 0; i < ps.length; i++) {
      if (ps[i]!.startsWith(':')) continue;
      if (ps[i] !== segs[i]) {
        ok = false;
        break;
      }
      fixed++;
    }
    if (ok && fixed > bestFixed) {
      best = p;
      bestFixed = fixed;
    }
  }
  if (best) return best;
  return '/' + segs.slice(0, 6).map((s) => (/^[a-z][a-z0-9-]{0,39}$/.test(s) ? s : ':x')).join('/');
}

/** Khoá trong `props` mà mỗi sự kiện của phễu mua mang (máy chủ bỏ sự kiện có khoá ngoài danh sách trắng). */
export interface PurchaseEventProps {
  screen_viewed: { route: string; referrerRoute: string | null };
  home_block_viewed: { block: string };
  product_card_click: { shelf: string; position: number; productSlug: string };
  product_viewed: { productSlug: string; hasVideo: boolean; imageCount: number; inStock: boolean };
  pdp_action: { action: PdpAction; productSlug: string };
  cart_viewed: { itemCount: number; subtotalBucket: SubtotalBucket };
  checkout_started: { entry: CheckoutEntry; itemCount: number };
  checkout_step: { step: CheckoutStep; paymentMethod?: string };
  checkout_abandoned: { lastStep: CheckoutLastStep };
  login_wall_shown: { from: string };
  login_started: { from: string };
  login_completed: { from: string };
  review_started: { orderAgeDays: number };
  review_submitted: { orderAgeDays: number };
  return_requested: { orderAgeDays: number };
}
export type PurchaseEventName = keyof PurchaseEventProps;

/** Bước của phễu mua trên bảng admin, theo thứ tự. `add_or_buy` = `pdp_action` với `add_to_cart` hoặc `buy_now`; `order_placed` là sự kiện máy chủ. */
export const PURCHASE_FUNNEL_STEPS = ['product_viewed', 'add_or_buy', 'checkout_started', 'place_order_click', 'order_placed'] as const;
export type PurchaseFunnelStep = (typeof PURCHASE_FUNNEL_STEPS)[number];

/** Số phiên khác nhau đã qua một bước, tách theo nền tảng; `total` = web + miniapp (một phiên chỉ thuộc một nền tảng). */
export interface PurchaseFunnelRow {
  step: PurchaseFunnelStep;
  web: number;
  miniapp: number;
  total: number;
}

export interface PurchaseFunnelWindowDTO {
  /** Đủ mọi bước của `PURCHASE_FUNNEL_STEPS`, đúng thứ tự. */
  rows: PurchaseFunnelRow[];
  /** Số phiên có ít nhất một sự kiện trong cửa sổ (mẫu số tham khảo). */
  sessions: { web: number; miniapp: number; total: number };
}

export interface PurchaseFunnelDTO {
  generatedAt: string;
  windows: Record<'h72' | 'd7' | 'd30', PurchaseFunnelWindowDTO>;
}

/**
 * Phễu Đổi rác phía khách (`recycle_funnel_step`, `props.step`). Chỉ đo hành vi trên màn hình; "đã nhận rác thật" là sự kiện server
 * `recycle_confirmed`, client không tự ghi được (xem SERVER_EVENT_NAMES).
 */
export const RECYCLE_FUNNEL_STEPS = ['enter', 'phone_saved', 'geo_granted', 'geo_denied', 'submitted', 'fee_short_shown', 'fee_path_attach', 'fee_path_wallet', 'fee_path_bank', 'fee_path_dropoff', 'second_order_shown', 'second_order_click'] as const;
export type RecycleFunnelStep = (typeof RECYCLE_FUNNEL_STEPS)[number];
export type RecycleFunnelSurface = 'web' | 'miniapp';

export interface RecycleFunnelProps {
  step: RecycleFunnelStep;
  surface: RecycleFunnelSurface;
  /** Đường giao khách đang chọn ở bước đó (DROP_OFF, MAIL_IN, HOME_PICKUP...). Bỏ trống khi chưa chọn. */
  lane?: string;
}

export const SERVER_EVENT_NAMES = [
  'add_to_cart',
  'coupon_applied',
  'engagement_action',
  'ext_claim_credited',
  'ext_claim_submitted',
  'game_cap_hit',
  'game_round_completed',
  'game_round_started',
  'notification_sent',
  'notification_suppressed',
  'order_paid',
  'order_place_failed',
  'order_placed',
  'order_status_changed',
  'recycle_confirmed',
  'referral_touched',
  'subscription_changed',
] as const;

export type ServerEventName = (typeof SERVER_EVENT_NAMES)[number];
