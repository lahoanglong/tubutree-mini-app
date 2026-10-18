import type { LoyaltyRates } from '@tubutree/app-core/api/loyalty';
import { decimalVi, pointsToSpend } from '@tubutree/app-core/loyalty-copy';
import { formatCount } from './checkout-points';
import { formatDate } from './format-date';
import { formatVnd } from './format-vnd';

export type { LoyaltyRates };
export { checkInView, earnPctOf, earnRuleLine, memberCardHint, percentLabel, pointsToSpend, tierProgressPercent } from '@tubutree/app-core/loyalty-copy';

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
export function tierThresholdLabel(tier: { minPoints: number; minSpending?: number | null }, rates?: LoyaltyRates): string {
  if (tier.minPoints <= 0 && !tier.minSpending) return 'hạng khởi đầu';
  if (!rates) return `từ ${formatCount(tier.minPoints)} điểm tích luỹ`;
  const spend = tier.minSpending ?? pointsToSpend(tier.minPoints, rates);
  return `từ ${moneyShort(spend)} mua hàng trong 12 tháng`;
}

const DAY_MS = 864e5;
const URGENT_WITHIN_DAYS = 30;

/**
 * "70 Điểm Xanh sẽ hết hạn ngày 20/10/2026": lô điểm thường hết hạn gần nhất để khách dùng trước. Trong 30 ngày
 * tới thêm "(còn N ngày)" và `urgent` để trang tô màu cảnh báo. Thiếu dữ liệu/ngày hỏng/0 điểm → null.
 */
export function expiringPointsNote(
  expiring: { amount: number; expiresAt: string } | null | undefined,
  now: Date = new Date(),
): { text: string; urgent: boolean } | null {
  if (!expiring || !(expiring.amount > 0)) return null;
  const at = new Date(expiring.expiresAt);
  if (Number.isNaN(at.getTime())) return null;
  const daysLeft = Math.max(0, Math.ceil((at.getTime() - now.getTime()) / DAY_MS));
  const urgent = daysLeft <= URGENT_WITHIN_DAYS;
  const base = `${formatCount(expiring.amount)} Điểm Xanh sẽ hết hạn ngày ${formatDate(at)}`;
  return { text: urgent ? `${base} (còn ${daysLeft} ngày)` : base, urgent };
}

/** Chính sách hạn điểm thường theo cấu hình; API cũ chưa trả số tháng → null (không tự bịa con số). */
export function pointExpiryPolicyNote(months: number | null | undefined): string | null {
  const n = Number(months ?? 0);
  return Number.isFinite(n) && n >= 1 ? `Điểm Xanh thường có hạn ${Math.floor(n)} tháng kể từ ngày nhận, điểm cũ được dùng trước.` : null;
}
