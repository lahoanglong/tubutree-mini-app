import { formatNumber, formatVnd } from './format';

/** Quy tắc tích/đổi Điểm Xanh do API trả từ SystemConfig (loyalty.vnd_per_point, vnd_per_point_redeem, max_redeem_pct). */
export interface LoyaltyRates {
  /** Phần trăm tiền hàng tích thành điểm (2 = 2%); thiếu khi API cũ chưa trả. */
  earnPct?: number;
  /** 100 / earnPct, giữ cho bản app cũ. */
  vndPerPoint: number;
  vndPerPointRedeem: number;
  maxRedeemPct: number;
}

/** Số thập phân kiểu Việt, bỏ ",0": 1.2 → "1,2", 5 → "5". */
function decimalVi(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

/** Tiền gọn cho mốc hạng: ≥ 1 triệu → "5 triệu"/"12,5 triệu", nhỏ hơn thì "750.000đ". */
export function moneyShort(n: number): string {
  return n >= 1_000_000 ? `${decimalVi(n / 1_000_000)} triệu` : formatVnd(n);
}

export function pointsToSpend(points: number, rates: LoyaltyRates): number {
  return points * rates.vndPerPoint;
}

/** "Cứ 10.000đ mua hàng = 1 điểm" (kèm hệ số hạng khi > 1). */
export function earnRuleLine(rates: LoyaltyRates, multiplier = 1): string {
  const base = `Cứ ${formatVnd(rates.vndPerPoint)} mua hàng = 1 điểm`;
  return multiplier > 1 ? `${base}, nhân hệ số hạng ×${decimalVi(multiplier)}` : base;
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
