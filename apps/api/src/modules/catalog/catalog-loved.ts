/** Khoá cấu hình ngưỡng nhãn "Được yêu thích" (Q5): chủ chỉnh ở tab Cấu hình, không cần deploy. */
export const CATALOG_LOVED_KEYS = {
  minRating: 'catalog.loved_min_rating',
  minReviews: 'catalog.loved_min_reviews',
  minSold: 'catalog.loved_min_sold',
} as const;

export interface LovedThresholds {
  minRating: number;
  minReviews: number;
  minSold: number;
}

export const DEFAULT_LOVED_THRESHOLDS: LovedThresholds = { minRating: 4.8, minReviews: 20, minSold: 50 };

/** Trần hợp lý của từng ngưỡng; cùng giá trị với luật ghi ở `SystemConfigService`. */
export const LOVED_THRESHOLD_MAX: LovedThresholds = { minRating: 5, minReviews: 100_000, minSold: 10_000_000 };

/**
 * Giá trị cấu hình hỏng (chuỗi, âm, NaN, vượt trần) lùi về mặc định: nếu đọc lỏng thì ngưỡng 0 hay NaN biến mọi
 * thẻ thành "Được yêu thích" (hoặc không thẻ nào), và nhãn mất ý nghĩa.
 */
export function sanitizeLovedThreshold(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : fallback;
}

/** `sold` là tổng đã bán hiển thị trên thẻ (soldExternal + soldApp), cùng số khách thấy. */
export function isLoved(p: { ratingAvg: number; reviewCount: number; sold: number }, t: LovedThresholds): boolean {
  return p.ratingAvg >= t.minRating && p.reviewCount >= t.minReviews && p.sold >= t.minSold;
}
