import {
  CHECKOUT_ENTRIES,
  CHECKOUT_LAST_STEPS,
  CHECKOUT_STEPS,
  ECO_FACT_KIND_NAMES,
  MATCHER_ENTRIES,
  isShareableSearchTerm,
  ORDER_ZALO_FRIEND_FROM,
  PDP_ACTIONS,
  RECYCLE_FUNNEL_STEPS,
  SUBTOTAL_BUCKETS,
  type ClientEventName,
} from '@tubutree/shared-types';

type Rule = (v: unknown) => boolean;

const str = (re: RegExp): Rule => (v) => typeof v === 'string' && re.test(v);
const text = (max: number): Rule => (v) => typeof v === 'string' && v.length <= max;
const int = (min: number, max: number): Rule => (v) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const bool: Rule = (v) => typeof v === 'boolean';
const oneOf = (values: readonly string[]): Rule => (v) => typeof v === 'string' && values.includes(v);
const orNull = (r: Rule): Rule => (v) => v === null || r(v);

const TOKEN = str(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/);
const LOWER_TOKEN = str(/^[a-z0-9][a-z0-9_-]{0,39}$/);
/** Mẫu route (`/san-pham/:slug`); Mini bản cũ gửi đường dẫn thật đã mã hoá phần trăm. */
const ROUTE = str(/^\/[A-Za-z0-9/:._~%-]{0,199}$/);
const SLUG = str(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/);
const ID = str(/^[A-Za-z0-9_-]{1,64}$/);
const COUNT = int(0, 500);
const AGE_DAYS = int(0, 3650);
const VND = int(0, 1_000_000_000);
const PAYMENT_METHOD = str(/^[A-Za-z_]{2,32}$/);

interface EventRule {
  props: Readonly<Record<string, Rule>>;
  required?: readonly string[];
}

/**
 * Danh sách trắng `props` cho từng sự kiện client. Sự kiện mang khoá ngoài danh sách, thiếu khoá bắt buộc hoặc giá trị sai khuôn bị bỏ:
 * client là của khách nên không tin, và bảng sự kiện không được thành chỗ chứa dữ liệu cá nhân. Record theo `ClientEventName` buộc khai
 * luật khi thêm tên sự kiện mới.
 */
export const CLIENT_EVENT_RULES: Record<ClientEventName, EventRule> = {
  app_opened: { props: { medium: LOWER_TOKEN } },
  screen_viewed: {
    props: { route: ROUTE, referrerRoute: orNull(ROUTE), prevRoute: orNull(ROUTE), msToContent: int(0, 86_400_000) },
    required: ['route'],
  },
  client_error: { props: { kind: TOKEN, messageHash: ID, route: text(200) } },
  product_viewed: {
    props: {
      productSlug: SLUG,
      hasVideo: bool,
      imageCount: int(0, 100),
      inStock: bool,
      productId: ID,
      variationId: ID,
      price: VND,
      isFlash: bool,
      listSource: TOKEN,
    },
  },
  checkout_started: {
    props: { entry: oneOf(CHECKOUT_ENTRIES), itemCount: COUNT, subtotal: VND, isSubset: bool },
  },
  notification_opened: { props: { notificationId: ID, templateCode: str(/^[A-Za-z0-9_.-]{1,64}$/) } },
  reorder_clicked: { props: { source: TOKEN, orderCode: ID, variationId: ID } },
  reorder_completed: { props: { source: TOKEN, added: COUNT, skipped: COUNT } },
  reorder_reminder_cta: { props: { notificationId: ID } },
  search_performed: { props: { q: text(100), resultsCount: int(0, 100_000) } },
  search_result_clicked: { props: { q: text(100), position: int(0, 1000), source: TOKEN, slug: SLUG } },
  filter_applied: { props: { type: TOKEN } },
  ext_claim_scan: { props: { result: TOKEN, parsed: TOKEN } },
  ext_claim_phone: { props: { result: TOKEN } },
  oa_follow_result: { props: { placement: TOKEN, result: TOKEN } },
  recycle_funnel_step: {
    props: { step: oneOf(RECYCLE_FUNNEL_STEPS), surface: oneOf(['web', 'miniapp']), lane: str(/^[A-Za-z0-9_-]{1,32}$/) },
    required: ['step', 'surface'],
  },
  home_block_viewed: { props: { block: TOKEN }, required: ['block'] },
  product_card_click: { props: { shelf: TOKEN, position: int(1, 500), productSlug: SLUG }, required: ['shelf', 'position', 'productSlug'] },
  pdp_action: { props: { action: oneOf(PDP_ACTIONS), productSlug: SLUG }, required: ['action', 'productSlug'] },
  cart_viewed: { props: { itemCount: COUNT, subtotalBucket: oneOf(SUBTOTAL_BUCKETS) }, required: ['itemCount', 'subtotalBucket'] },
  checkout_step: { props: { step: oneOf(CHECKOUT_STEPS), paymentMethod: PAYMENT_METHOD }, required: ['step'] },
  checkout_abandoned: { props: { lastStep: oneOf(CHECKOUT_LAST_STEPS) }, required: ['lastStep'] },
  login_wall_shown: { props: { from: ROUTE }, required: ['from'] },
  login_started: { props: { from: ROUTE }, required: ['from'] },
  login_completed: { props: { from: ROUTE }, required: ['from'] },
  review_started: { props: { orderAgeDays: AGE_DAYS }, required: ['orderAgeDays'] },
  review_submitted: { props: { orderAgeDays: AGE_DAYS }, required: ['orderAgeDays'] },
  return_requested: { props: { orderAgeDays: AGE_DAYS }, required: ['orderAgeDays'] },
  order_zalo_consent_shown: { props: {} },
  order_zalo_consent_checked: { props: { checked: bool }, required: ['checked'] },
  order_zalo_friend_click: { props: { from: oneOf(ORDER_ZALO_FRIEND_FROM) }, required: ['from'] },
  eco_badge_opened: { props: { productSlug: SLUG, kind: oneOf(ECO_FACT_KIND_NAMES) }, required: ['productSlug', 'kind'] },
  eco_passport_viewed: { props: { hasData: bool }, required: ['hasData'] },
  eco_passport_shared: { props: {} },
  // Dòng thời gian một khối, bật Zalo từ chi tiết đơn, trang đích link mời. Không mang mã đơn hay mã mời (mã mời chỉ ra người mời).
  order_timeline_viewed: { props: { status: str(/^[A-Z_]{2,32}$/), hasCarrierEvents: bool }, required: ['status', 'hasCarrierEvents'] },
  order_zalo_consent_from_detail: { props: {} },
  invite_landing_viewed: { props: {} },
  invite_landing_cta: { props: {} },
  invite_progress_viewed: { props: {} },
  matcher_started: { props: { entry: oneOf(MATCHER_ENTRIES) }, required: ['entry'] },
  matcher_question_answered: { props: { index: int(1, 5) }, required: ['index'] },
  matcher_completed: {
    props: { outcomeId: ID, fallback: bool, seconds: (v) => int(0, 3600)(v) && (v as number) % 5 === 0 },
    required: ['outcomeId', 'fallback', 'seconds'],
  },
  matcher_add_all: { props: { itemCount: int(1, 4) }, required: ['itemCount'] },
  matcher_item_opened: { props: { productSlug: SLUG }, required: ['productSlug'] },
  // Tìm không ra gì: `q` đã lọc ở app (isShareableSearchTerm), máy chủ kiểm lại để cụm có email/dãy số không vào bảng.
  search_zero_result: {
    props: { q: (v) => text(100)(v) && isShareableSearchTerm(v as string), hadSuggestion: bool },
    required: ['q', 'hadSuggestion'],
  },
};

/**
 * Dãy 9 tới 12 chữ số đứng riêng (có thể ngăn bằng dấu cách, chấm, gạch, ngoặc), không dính chữ hay số hai đầu: chuỗi số trong id/uuid
 * dính chữ nên không khớp. Sau khi bỏ dấu ngăn, bắt đầu bằng 0 hoặc 84 là dạng số điện thoại Việt Nam.
 */
const DIGIT_RUN = /(?<![\p{L}\p{N}])\+?\d(?:[ .()-]?\d){8,11}(?![\p{L}\p{N}])/gu;
const VN_PHONE_DIGITS = /^(?:84|0)\d{9,10}$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function looksLikePii(s: string): boolean {
  if (s.includes('@') && EMAIL.test(s)) return true;
  for (const m of s.matchAll(DIGIT_RUN)) {
    if (VN_PHONE_DIGITS.test(m[0].replace(/\D/g, ''))) return true;
  }
  return false;
}

export type PropsVerdict = 'ok' | 'unknown_key' | 'missing_key' | 'bad_value' | 'pii';

/** Kiểm `props` của một sự kiện client theo danh sách trắng; `ok` mới được ghi. */
export function checkEventProps(eventName: string, props: Record<string, unknown> | undefined): PropsVerdict {
  const rule = (CLIENT_EVENT_RULES as Record<string, EventRule | undefined>)[eventName];
  if (!rule) return 'unknown_key';
  const p = props ?? {};
  for (const key of rule.required ?? []) {
    if (p[key] === undefined) return 'missing_key';
  }
  for (const [key, value] of Object.entries(p)) {
    const check = rule.props[key];
    if (!check) return 'unknown_key';
    if (value === undefined) continue;
    if (!check(value)) return 'bad_value';
    if (typeof value === 'string' && looksLikePii(value)) return 'pii';
  }
  return 'ok';
}
