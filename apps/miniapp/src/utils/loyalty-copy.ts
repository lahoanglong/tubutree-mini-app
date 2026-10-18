import { decimalVi, earnPctOf, pointsToSpend } from '@tubutree/app-core/loyalty-copy';
import { formatNumber, formatVnd } from './format';

export { earnPctOf, earnRuleLine, percentLabel, pointsToSpend } from '@tubutree/app-core/loyalty-copy';

/** Quy tắc tích/đổi Điểm Xanh do API trả từ SystemConfig (loyalty.earn_pct, vnd_per_point_redeem, max_redeem_pct). */
export interface LoyaltyRates {
  /** Phần trăm tiền hàng tích thành điểm (2 = 2%); thiếu khi API cũ chưa trả. */
  earnPct?: number;
  /** 100 / earnPct, giữ cho bản app cũ. */
  vndPerPoint: number;
  vndPerPointRedeem: number;
  maxRedeemPct: number;
}

/** Tiền gọn cho mốc hạng: ≥ 1 triệu → "5 triệu"/"12,5 triệu", nhỏ hơn thì "750.000đ". */
export function moneyShort(n: number): string {
  return n >= 1_000_000 ? `${decimalVi(n / 1_000_000)} triệu` : formatVnd(n);
}

/** Giá trị 1 điểm khi dùng; trần % chỉ nói khi admin còn cho dùng điểm ở thanh toán. */
export function redeemRuleLine(rates: LoyaltyRates): string {
  const value = formatVnd(rates.vndPerPointRedeem);
  if (rates.maxRedeemPct > 0) {
    return `1 điểm = ${value} khi dùng ở bước thanh toán (tối đa ${Math.round(rates.maxRedeemPct * 100)}% giá trị đơn)`;
  }
  return `1 điểm = ${value} khi đổi mã giảm giá`;
}

/**
 * Mốc của một hạng. Hạng xét theo chi tiêu 12 tháng nên nói bằng tiền (minSpending của hạng, thiếu thì quy từ điểm);
 * API cũ chưa trả `rates` thì giữ cách nói theo điểm.
 */
export function tierThresholdLabel(
  tier: { minPoints: number; minSpending?: number | null },
  rates?: LoyaltyRates,
): string {
  if (tier.minPoints <= 0 && !tier.minSpending) return 'hạng khởi đầu';
  if (!rates) return `từ ${formatNumber(tier.minPoints)} điểm tích luỹ`;
  const spend = tier.minSpending ?? pointsToSpend(tier.minPoints, rates);
  return `từ ${moneyShort(spend)} mua hàng trong 12 tháng`;
}

export type PointsBoost =
  | { kind: 'compare'; double: boolean; appPct: number; marketplacePct: number }
  | { kind: 'plain'; appPct: number };

/**
 * Cách nói "mua trong Mini App tích nhiều hơn đơn sàn" từ config công khai. So sánh chỉ khi cờ tích đơn sàn bật và cả hai mức dùng
 * được và đơn app thật sự cao hơn; ngược lại chỉ nói mức đơn app. null khi không có mức đơn app dùng được.
 */
export function pointsBoostOf(loyalty: { earnPct?: number; vndPerPoint?: number; marketplaceEarnPct?: number; marketplaceClaimEnabled?: boolean } | undefined): PointsBoost | null {
  if (!loyalty) return null;
  const appPct = earnPctOf(loyalty);
  if (appPct == null) return null;
  const m = loyalty.marketplaceEarnPct;
  if (loyalty.marketplaceClaimEnabled === true && typeof m === 'number' && Number.isFinite(m) && m > 0 && appPct > m) {
    return { kind: 'compare', double: Math.abs(appPct - 2 * m) < 1e-9, appPct, marketplacePct: m };
  }
  return { kind: 'plain', appPct };
}
