import { DEFAULT_MARKETPLACE_EARN_PCT, MARKETPLACE_EARN_PCT_KEY, MAX_MARKETPLACE_EARN_PCT } from '../loyalty/earn-rates';
import type { SystemConfigService } from '../system-config/system-config.service';

/** Khoá cấu hình tích điểm đơn sàn (B6). Mọi đường cộng điểm nằm sau `loyalty.marketplace_claim_enabled` (mặc định tắt). */
export const MARKETPLACE_CLAIM_ENABLED_KEY = 'loyalty.marketplace_claim_enabled';
export const MARKETPLACE_CLAIM_DAILY_ATTEMPTS_KEY = 'loyalty.marketplace_claim_daily_attempts';
export const MARKETPLACE_CLAIM_DAILY_MAX_KEY = 'loyalty.marketplace_claim_daily_max';
export const MARKETPLACE_CLAIM_MONTHLY_CAP_KEY = 'loyalty.marketplace_claim_monthly_points_cap';
export const MARKETPLACE_CLAIM_MAX_AGE_KEY = 'loyalty.marketplace_claim_max_age_days';
export const MARKETPLACE_CLAIM_REVIEW_ABOVE_KEY = 'loyalty.marketplace_claim_review_above_vnd';
export const EXTERNAL_PENDING_DAYS_KEY = 'loyalty.external_pending_days';
export const EXTERNAL_SINCE_KEY = 'loyalty.external_since';
export const EXTERNAL_LOOKUP_ENABLED_KEY = 'pancake.external_lookup_enabled';
export const EXTERNAL_POLL_ENABLED_KEY = 'pancake.external_poll_enabled';

export interface ClaimConfig {
  enabled: boolean;
  /** Phần trăm (1 = 1%), cùng đơn vị với loyalty.earn_pct. */
  earnPct: number;
  dailyAttempts: number;
  dailyMax: number;
  monthlyPointsCap: number;
  maxAgeDays: number;
  reviewAboveVnd: number;
  pendingDays: number;
  /** Đơn Pancake tạo trước mốc này không được tích. null = chỉ áp maxAgeDays. */
  externalSince: Date | null;
}

export const CLAIM_CONFIG_DEFAULTS: ClaimConfig = {
  enabled: false,
  earnPct: DEFAULT_MARKETPLACE_EARN_PCT,
  dailyAttempts: 10,
  dailyMax: 3,
  monthlyPointsCap: 200_000,
  maxAgeDays: 60,
  reviewAboveVnd: 2_000_000,
  pendingDays: 14,
  externalSince: null,
};

const MAX_AGE_DAYS_CEILING = 365;

/** Số ngày tuổi tối đa của đơn được tích, đã chuẩn hoá như `loadClaimConfig` (dùng cho public config). */
export function normalizeClaimMaxAgeDays(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? Math.min(raw, MAX_AGE_DAYS_CEILING) : CLAIM_CONFIG_DEFAULTS.maxAgeDays;
}

function intIn(raw: unknown, fallback: number, min: number, max: number): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= min ? Math.min(raw, max) : fallback;
}

/** Đọc lỏng: giá trị hỏng rơi về mặc định (không bao giờ ném) để một khoá gõ nhầm không làm hỏng đường claim hay cron. */
export async function loadClaimConfig(config: Pick<SystemConfigService, 'get'>): Promise<ClaimConfig> {
  const d = CLAIM_CONFIG_DEFAULTS;
  const [enabled, earnPct, dailyAttempts, dailyMax, cap, maxAge, reviewAbove, pendingDays, since] = await Promise.all([
    config.get<unknown>(MARKETPLACE_CLAIM_ENABLED_KEY, d.enabled),
    config.get<unknown>(MARKETPLACE_EARN_PCT_KEY, d.earnPct),
    config.get<unknown>(MARKETPLACE_CLAIM_DAILY_ATTEMPTS_KEY, d.dailyAttempts),
    config.get<unknown>(MARKETPLACE_CLAIM_DAILY_MAX_KEY, d.dailyMax),
    config.get<unknown>(MARKETPLACE_CLAIM_MONTHLY_CAP_KEY, d.monthlyPointsCap),
    config.get<unknown>(MARKETPLACE_CLAIM_MAX_AGE_KEY, d.maxAgeDays),
    config.get<unknown>(MARKETPLACE_CLAIM_REVIEW_ABOVE_KEY, d.reviewAboveVnd),
    config.get<unknown>(EXTERNAL_PENDING_DAYS_KEY, d.pendingDays),
    config.get<unknown>(EXTERNAL_SINCE_KEY, null),
  ]);
  // Ngày thuần YYYY-MM-DD là 00:00 giờ Việt Nam, không phải 00:00 UTC (lệch 7 tiếng làm đơn đầu ngày bị loại nhầm).
  const sinceText = typeof since === 'string' ? since.trim() : '';
  const sinceDate = sinceText === '' ? null : new Date(/^\d{4}-\d{2}-\d{2}$/.test(sinceText) ? `${sinceText}T00:00:00+07:00` : sinceText);
  return {
    enabled: enabled === true,
    earnPct: typeof earnPct === 'number' && Number.isFinite(earnPct) && earnPct > 0 ? Math.min(earnPct, MAX_MARKETPLACE_EARN_PCT) : d.earnPct,
    dailyAttempts: intIn(dailyAttempts, d.dailyAttempts, 1, 1000),
    dailyMax: intIn(dailyMax, d.dailyMax, 1, 1000),
    monthlyPointsCap: intIn(cap, d.monthlyPointsCap, 1, 100_000_000),
    maxAgeDays: intIn(maxAge, d.maxAgeDays, 1, MAX_AGE_DAYS_CEILING),
    reviewAboveVnd: intIn(reviewAbove, d.reviewAboveVnd, 1, 2_000_000_000),
    pendingDays: intIn(pendingDays, d.pendingDays, 1, 90),
    externalSince: sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : null,
  };
}
