import { DEFAULT_EARN_PCT, EARN_PCT_KEY } from '../loyalty/earn-rates';
import type { SystemConfigService } from '../system-config/system-config.service';
import { loadClaimConfig } from './external-claim.config';

/** Khoá cấu hình tích điểm đơn chat/điện thoại (B9). Mọi đường tạo hay cộng claim PHONE nằm sau `loyalty.chat_order_points_enabled` (mặc định tắt). */
export const CHAT_ORDER_POINTS_ENABLED_KEY = 'loyalty.chat_order_points_enabled';
export const CHAT_ORDER_EARN_PCT_KEY = 'loyalty.chat_order_earn_pct';
export const CHAT_ORDER_MONTHLY_CAP_KEY = 'loyalty.chat_order_monthly_points_cap';
export const CHAT_ORDER_REVIEW_ABOVE_KEY = 'loyalty.chat_order_review_above_vnd';
export const CHAT_ORDER_REQUIRE_CARRIER_KEY = 'loyalty.chat_order_require_carrier';
export const CHAT_UNCLAIMED_HOLD_DAYS_KEY = 'loyalty.chat_unclaimed_hold_days';

export interface ChatConfig {
  enabled: boolean;
  /** Phần trăm (2 = 2%) đã quyết: `loyalty.chat_order_earn_pct`, null thì `loyalty.earn_pct` của đơn app. */
  earnPct: number;
  /** Trần điểm mỗi SĐT mỗi tháng VN (cộng các claim còn hiệu lực). */
  monthlyPointsCap: number;
  reviewAboveVnd: number;
  /** Chỉ cộng khi đơn có `partner.extend_code` hoặc status 16: đơn không có vận đơn không có bằng chứng giao hàng thật. */
  requireCarrier: boolean;
  /** Số ngày giữ điểm cho SĐT chưa là thành viên, tính từ lúc điểm đáng lẽ được cộng. */
  holdDays: number;
  pendingDays: number;
  externalSince: Date | null;
  maxAgeDays: number;
}

export const CHAT_CONFIG_DEFAULTS = {
  enabled: false,
  monthlyPointsCap: 200_000,
  reviewAboveVnd: 5_000_000,
  requireCarrier: true,
  holdDays: 30,
} as const;

const MAX_EARN_PCT = 20;

function intIn(raw: unknown, fallback: number, min: number, max: number): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= min ? Math.min(raw, max) : fallback;
}

const validPct = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Đọc lỏng như loadClaimConfig: giá trị hỏng rơi về mặc định, không bao giờ ném. Cờ chỉ bật khi đúng boolean true. */
export async function loadChatConfig(config: Pick<SystemConfigService, 'get'>): Promise<ChatConfig> {
  const d = CHAT_CONFIG_DEFAULTS;
  const [enabled, chatPct, appPct, cap, reviewAbove, carrier, hold, base] = await Promise.all([
    config.get<unknown>(CHAT_ORDER_POINTS_ENABLED_KEY, d.enabled),
    config.get<unknown>(CHAT_ORDER_EARN_PCT_KEY, null),
    config.get<unknown>(EARN_PCT_KEY, DEFAULT_EARN_PCT),
    config.get<unknown>(CHAT_ORDER_MONTHLY_CAP_KEY, d.monthlyPointsCap),
    config.get<unknown>(CHAT_ORDER_REVIEW_ABOVE_KEY, d.reviewAboveVnd),
    config.get<unknown>(CHAT_ORDER_REQUIRE_CARRIER_KEY, d.requireCarrier),
    config.get<unknown>(CHAT_UNCLAIMED_HOLD_DAYS_KEY, d.holdDays),
    loadClaimConfig(config),
  ]);
  const pct = validPct(chatPct) ? chatPct : validPct(appPct) ? appPct : DEFAULT_EARN_PCT;
  return {
    enabled: enabled === true,
    earnPct: Math.min(pct, MAX_EARN_PCT),
    monthlyPointsCap: intIn(cap, d.monthlyPointsCap, 1, 100_000_000),
    reviewAboveVnd: intIn(reviewAbove, d.reviewAboveVnd, 1, 2_000_000_000),
    // Chỉ `false` thật mới tắt yêu cầu vận đơn: giá trị hỏng giữ chế độ an toàn.
    requireCarrier: carrier !== false,
    holdDays: intIn(hold, d.holdDays, 1, 365),
    pendingDays: base.pendingDays,
    externalSince: base.externalSince,
    maxAgeDays: base.maxAgeDays,
  };
}
