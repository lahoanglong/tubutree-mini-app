import type { CheckInStatusResponse, LoyaltyOverview, LoyaltyRates, MemberCardResponse } from '@tubutree/app-core/api/loyalty';
import { formatCount } from './checkout-points';
import { formatDate } from './format-date';
import { formatVnd } from './format-vnd';

export type { LoyaltyRates };

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

/** "Tích 2% tiền hàng thành Điểm Xanh" (kèm "hạng ×1,2 = 2,4%" khi hệ số > 1). */
export function earnRuleLine(rates: LoyaltyRates, multiplier = 1): string {
  const pct = earnPctOf(rates);
  if (pct == null) return 'Mỗi đơn đã giao được tích Điểm Xanh';
  const base = `Tích ${percentLabel(pct)} tiền hàng thành Điểm Xanh`;
  return multiplier > 1 ? `${base} (hạng ×${decimalVi(multiplier)} = ${percentLabel(pct * multiplier)})` : base;
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

/**
 * % tiến độ lên hạng kế. Hạng có mốc chi tiêu thì đo theo TIỀN MUA 12 tháng (spent12m, cùng số backend dùng để xét hạng);
 * hạng không có mốc chi tiêu hoặc API cũ chưa trả spent12m thì đo theo điểm XÉT HẠNG (tierPoints). Đo theo số dư
 * (có điểm danh/POS) sẽ vẽ thanh gần đầy trong khi backend không bao giờ cho lên hạng.
 */
export function tierProgressPercent(
  ov: Pick<LoyaltyOverview, 'pointsBalance' | 'tier' | 'nextTier' | 'tiers' | 'spent12m' | 'tierPoints'>,
): number {
  const next = ov.nextTier;
  if (!next) return 100;
  const curTier = ov.tiers.find((t) => t.id === ov.tier?.id);
  if (next.minSpending != null && ov.spent12m !== undefined) {
    const curSpend = curTier?.minSpending ?? 0;
    if (next.minSpending <= curSpend) return 100;
    return Math.min(100, Math.max(0, Math.round(((ov.spent12m - curSpend) / (next.minSpending - curSpend)) * 100)));
  }
  const curMin = curTier?.minPoints ?? 0;
  if (next.minPoints <= curMin) return 100;
  const pts = ov.tierPoints ?? ov.pointsBalance;
  return Math.min(100, Math.max(0, Math.round(((pts - curMin) / (next.minPoints - curMin)) * 100)));
}

export function checkInView(s: CheckInStatusResponse): { canCheckIn: boolean; buttonLabel: string } {
  if (s.checkedInToday) return { canCheckIn: false, buttonLabel: 'Đã điểm danh' };
  const pts = s.todayPoints ?? s.rewards.find((r) => r.isToday)?.points ?? 0;
  return { canCheckIn: true, buttonLabel: pts > 0 ? `Điểm danh +${pts}` : 'Điểm danh' };
}

/** Lời nhắc dưới QR thẻ thành viên: chỉ hứa tích điểm tại quầy khi backend thật sự bật. */
export function memberCardHint(card: Pick<MemberCardResponse, 'posCreditEnabled'>): string {
  return card.posCreditEnabled
    ? 'Đưa mã QR này cho thu ngân khi thanh toán tại cửa hàng Tubu để được tích Điểm Xanh.'
    : 'Đây là mã thành viên của bạn. Tích Điểm Xanh khi mua tại cửa hàng chưa được áp dụng — hiện điểm được tích khi mua hàng online.';
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
