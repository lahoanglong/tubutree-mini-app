/**
 * Khoá cấu hình của vòng giới thiệu (thưởng đơn đầu, thẻ thành tích). File không import gì để admin-config-rules, cấu hình công khai và
 * luồng thưởng dùng chung mà không kéo theo service nào (vòng import làm Nest không dựng được module).
 */
export const REFERRAL_VIRAL_ENABLED_KEY = 'growth.referral_viral_enabled';
export const REFERRAL_FIRST_ORDER_POINTS_KEY = 'growth.referral_first_order_points';
export const REFERRAL_FIRST_ORDER_MIN_KEY = 'growth.referral_first_order_min';
export const REFERRAL_MONTHLY_CAP_KEY = 'growth.referral_monthly_cap';

export const REFERRAL_FIRST_ORDER_POINTS_DEFAULT = 100;
export const REFERRAL_FIRST_ORDER_MIN_DEFAULT = 199_000;
export const REFERRAL_MONTHLY_CAP_DEFAULT = 10;
/** Biên admin được lưu (admin-config-rules) và biên đọc ở đây: một nguồn. */
export const REFERRAL_FIRST_ORDER_POINTS_MAX = 10_000;
export const REFERRAL_FIRST_ORDER_MIN_MAX = 100_000_000;
export const REFERRAL_MONTHLY_CAP_MAX = 1_000;

export interface ConfigReader {
  get<T>(key: string, fallback?: T): Promise<T>;
}

export interface ViralRules {
  enabled: boolean;
  points: number;
  minOrder: number;
  monthlyCap: number;
}

const intOr = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

/** Đọc cờ và số. Chỉ boolean true thật mới bật; số hỏng rơi về mặc định (cùng biên với admin-config-rules). */
export async function readViralRules(config: ConfigReader): Promise<ViralRules> {
  const [enabled, points, minOrder, cap] = await Promise.all([
    config.get<unknown>(REFERRAL_VIRAL_ENABLED_KEY, false),
    config.get<unknown>(REFERRAL_FIRST_ORDER_POINTS_KEY, REFERRAL_FIRST_ORDER_POINTS_DEFAULT),
    config.get<unknown>(REFERRAL_FIRST_ORDER_MIN_KEY, REFERRAL_FIRST_ORDER_MIN_DEFAULT),
    config.get<unknown>(REFERRAL_MONTHLY_CAP_KEY, REFERRAL_MONTHLY_CAP_DEFAULT),
  ]);
  return {
    enabled: enabled === true,
    points: intOr(points, REFERRAL_FIRST_ORDER_POINTS_DEFAULT, 0, REFERRAL_FIRST_ORDER_POINTS_MAX),
    minOrder: intOr(minOrder, REFERRAL_FIRST_ORDER_MIN_DEFAULT, 0, REFERRAL_FIRST_ORDER_MIN_MAX),
    monthlyCap: intOr(cap, REFERRAL_MONTHLY_CAP_DEFAULT, 0, REFERRAL_MONTHLY_CAP_MAX),
  };
}

