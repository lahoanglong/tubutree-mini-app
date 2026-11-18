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
  'eco_badge_opened',
  'eco_passport_viewed',
  'eco_passport_shared',
  'order_timeline_viewed',
  'order_zalo_consent_from_detail',
  'invite_landing_viewed',
  'invite_landing_cta',
  'invite_progress_viewed',
  'matcher_started',
  'matcher_question_answered',
  'matcher_completed',
  'matcher_add_all',
  'matcher_item_opened',
  'search_zero_result',
  'checkout_address_switched',
  'transfer_preview_shown',
  'transfer_qr_shown',
  'green_box_progress_shown',
  'green_box_tier_reached',
  'green_box_page_viewed',
  'subscription_suggestion_shown',
  'subscription_suggestion_accepted',
  'guest_checkout_start',
  'web_vital',
  'mini_vital',
  'refill_swap_shown',
  'refill_swap_applied',
  'refill_swap_undone',
] as const;

/** Nơi hiện gợi ý đổi chai sang gói Refill (`refill_swap_*.surface`). */
export const REFILL_SWAP_SURFACES = ['cart', 'reorder'] as const;
export type RefillSwapSurface = (typeof REFILL_SWAP_SURFACES)[number];

/** Nơi khách đổi địa chỉ giao ở màn thanh toán (`checkout_address_switched.from`). */
export const CHECKOUT_ADDRESS_SWITCH_FROM = ['sheet'] as const;
export type CheckoutAddressSwitchFrom = (typeof CHECKOUT_ADDRESS_SWITCH_FROM)[number];

export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

/**
 * Số đo tốc độ trên máy khách thật (`web_vital`, `mini_vital`; cờ `perf.rum_enabled`, tỉ lệ lấy mẫu `perf.rum_sample_pct`). Một sự kiện là
 * một số đo của một lượt xem trang. `READY` (chỉ Mini App): mili giây từ lúc mở app tới lần rảnh đầu tiên của luồng chính sau sự kiện `load`,
 * tức màn đầu đã vẽ và bấm được.
 */
export const WEB_VITAL_NAMES = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'] as const;
export const MINI_VITAL_NAMES = ['LCP', 'CLS', 'READY'] as const;
export type VitalName = (typeof WEB_VITAL_NAMES)[number] | (typeof MINI_VITAL_NAMES)[number];
export const VITAL_RATINGS = ['good', 'needs-improvement', 'poor'] as const;
export type VitalRating = (typeof VITAL_RATINGS)[number];
/** Nhóm bề rộng khung nhìn: `s` ≤ 480px, `m` ≤ 1024px, `l` > 1024px. */
export const VITAL_VIEWPORTS = ['s', 'm', 'l'] as const;
export type VitalViewport = (typeof VITAL_VIEWPORTS)[number];
export const VITAL_NET_TYPES = ['slow-2g', '2g', '3g', '4g', 'unknown'] as const;
export const VITAL_NAV_TYPES = ['navigate', 'reload', 'back-forward', 'back-forward-cache', 'prerender', 'restore'] as const;

/**
 * Ngưỡng [tốt tới, kém từ sau] theo Core Web Vitals (web.dev, p75): LCP 2,5 s / 4 s, CLS 0,1 / 0,25, INP 200 / 500 ms, FCP 1,8 / 3 s,
 * TTFB 0,8 / 1,8 s. `READY` không có chuẩn: dùng ngưỡng TTI của Lighthouse trên điện thoại (3,8 / 7,3 s). Giá trị ≤ mốc đầu là tốt, > mốc sau là kém.
 */
export const VITAL_THRESHOLDS: Readonly<Record<VitalName, readonly [number, number]>> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  READY: [3800, 7300],
};

/** Trần hợp lý của từng số đo: lớn hơn là máy hỏng hay gửi giả, máy chủ bỏ. CLS không có đơn vị, còn lại là mili giây. */
export const VITAL_MAX: Readonly<Record<VitalName, number>> = { LCP: 60_000, CLS: 10, INP: 60_000, FCP: 60_000, TTFB: 60_000, READY: 120_000 };

export function vitalRating(name: VitalName, value: number): VitalRating {
  const [good, poor] = VITAL_THRESHOLDS[name];
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
}

/** Bề ngang tối đa (px CSS) của nhóm khung nhìn `s` (điện thoại) và `m` (máy tính bảng); rộng hơn `m` là `l`. */
export const VITAL_VIEWPORT_MAX = { s: 480, m: 1024 } as const;

export function vitalViewport(width: number): VitalViewport {
  return width <= VITAL_VIEWPORT_MAX.s ? 's' : width <= VITAL_VIEWPORT_MAX.m ? 'm' : 'l';
}

/** Lối khách vào Chọn Chuẩn Xanh (`matcher_started.entry`). */
export const MATCHER_ENTRIES = ['play_today', 'tu_van', 'advisor_paused', 'empty_cart', 'direct'] as const;
export type MatcherEntry = (typeof MATCHER_ENTRIES)[number];

/**
 * Từ khoá khách gõ được phép đi tiếp (sự kiện `search_zero_result`, danh sách "Tìm phổ biến"): bỏ cụm có `@` hay dãy từ 6 chữ số (bỏ qua
 * mọi ký tự không phải chữ hay số giữa các số, vd. `0912_345_678`) để không lộ email, số điện thoại khách gõ nhầm vào ô tìm.
 */
export function isShareableSearchTerm(term: string): boolean {
  if (term.includes('@')) return false;
  return !/\d{6,}/.test(term.replace(/[^\p{L}\p{N}]/gu, ''));
}

/** Nơi khách bấm "Mở Zalo Tubu Tree" (`order_zalo_friend_click.from`). */
export const ORDER_ZALO_FRIEND_FROM = ['success', 'order_detail'] as const;
export type OrderZaloFriendFrom = (typeof ORDER_ZALO_FRIEND_FROM)[number];

/** Loại sự thật xanh (`eco_badge_opened.kind`), cùng tập với enum `EcoFactKind` của API. */
export const ECO_FACT_KIND_NAMES = ['REFILL_PACK', 'PLASTIC_AVOIDED', 'RETURNABLE_PACKAGING', 'CERTIFICATION', 'INGREDIENT_ORIGIN'] as const;
export type EcoFactKindName = (typeof ECO_FACT_KIND_NAMES)[number];

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
export const RECYCLE_FUNNEL_STEPS = ['enter', 'phone_saved', 'geo_granted', 'geo_denied', 'submitted', 'fee_short_shown', 'fee_path_attach', 'fee_path_wallet', 'fee_path_bank', 'fee_path_dropoff', 'second_order_shown', 'second_order_click', 'return_nudge_shown', 'return_nudge_applied'] as const;
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
  'guest_order_claimed',
  'guest_order_placed',
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
