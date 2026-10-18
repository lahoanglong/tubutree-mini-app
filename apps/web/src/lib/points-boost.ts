/** Số thập phân kiểu Việt, bỏ ",0": 1.2 → "1,2", 5 → "5". */
function decimalVi(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

/** Phần trăm tiền hàng tích thành điểm: ưu tiên `earnPct`, API cũ chỉ có `vndPerPoint` thì quy ngược; null khi không có số dùng được. */
export function earnPctOf(rates: { earnPct?: number; vndPerPoint?: number }): number | null {
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (ok(rates.earnPct)) return rates.earnPct;
  return ok(rates.vndPerPoint) ? 100 / rates.vndPerPoint : null;
}

/** "2%" / "2,4%": phần trăm tiền hàng, bỏ ",0". */
export function percentLabel(pct: number): string {
  return `${decimalVi(pct)}%`;
}

export type PointsBoost =
  | { kind: 'compare'; double: boolean; appPct: number; marketplacePct: number }
  | { kind: 'plain'; appPct: number };

/**
 * Cách nói "mua ở Tubu Tree tích nhiều hơn đơn sàn" từ config công khai. So sánh chỉ khi cờ tích đơn sàn bật và cả hai mức dùng
 * được và đơn Tubu thật sự cao hơn; ngược lại chỉ nói mức đơn Tubu. null khi không có mức đơn Tubu dùng được.
 */
export function pointsBoostOf(
  loyalty: { earnPct?: number; vndPerPoint?: number; marketplaceEarnPct?: number; marketplaceClaimEnabled?: boolean } | undefined,
): PointsBoost | null {
  if (!loyalty) return null;
  const appPct = earnPctOf(loyalty);
  if (appPct == null) return null;
  const m = loyalty.marketplaceEarnPct;
  if (loyalty.marketplaceClaimEnabled === true && typeof m === 'number' && Number.isFinite(m) && m > 0 && appPct > m) {
    return { kind: 'compare', double: Math.abs(appPct - 2 * m) < 1e-9, appPct, marketplacePct: m };
  }
  return { kind: 'plain', appPct };
}
