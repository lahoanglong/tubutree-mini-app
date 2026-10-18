import type { LoyaltyRates } from './loyalty-copy';

/**
 * Điểm Xanh tích cho một kiện hàng — bản sao của pointsForGoods ở apps/api/src/modules/pricing/points-earn.ts (hàm server
 * dùng khi chốt đơn). Miniapp không import chéo package; spec của file này so từng giá trị với hàm của server.
 */
export function pointsForGoods(goodsValue: number, vndPerPoint: number, tierMultiplier = 1): number {
  if (vndPerPoint <= 0) return 0;
  return Math.floor((goodsValue / vndPerPoint) * tierMultiplier);
}

/** `points` Điểm Xanh, quy ra `valueVnd` khi dùng; 'generic' = chưa chắc con số nên chỉ nói chung; null = không có gì để nói. */
export type PointsEarnPreview = { points: number; valueVnd: number } | 'generic' | null;

const usable = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Điểm Xanh khách nhận khi mua `goods` đồng hàng, từ mốc trong config công khai và hệ số hạng. Chỉ nêu số khi mọi tham số của
 * công thức server đều đã biết: thiếu mốc (API cũ), cấu hình hỏng hoặc chưa biết hệ số hạng (`multiplier` null) thì nói chung.
 */
export function pointsEarnPreview(
  goods: number,
  rates: Pick<LoyaltyRates, 'vndPerPoint' | 'vndPerPointRedeem'> | undefined,
  multiplier: number | null,
): PointsEarnPreview {
  if (!rates || !usable(rates.vndPerPoint) || !usable(rates.vndPerPointRedeem) || !usable(multiplier ?? undefined)) return 'generic';
  if (!Number.isFinite(goods) || goods <= 0) return null;
  const points = pointsForGoods(goods, rates.vndPerPoint, multiplier ?? 1);
  return points > 0 ? { points, valueVnd: points * rates.vndPerPointRedeem } : null;
}
