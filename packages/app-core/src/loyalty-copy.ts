import type { CheckInStatusResponse, LoyaltyOverview, LoyaltyRates, MemberCardResponse } from './api/loyalty';

/** Số thập phân kiểu Việt, bỏ ",0": 1.2 → "1,2", 5 → "5". */
export function decimalVi(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
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
  // Nhãn không kèm số: số điểm/giọt nước còn thiếu nằm ở dòng "Hôm nay nhận …" (checkInTodayLine), tránh hai chỗ ghi lệch nhau.
  return { canCheckIn: true, buttonLabel: 'Điểm danh' };
}

/** Lời nhắc dưới QR thẻ thành viên: chỉ hứa tích điểm tại quầy khi backend thật sự bật. */
export function memberCardHint(card: Pick<MemberCardResponse, 'posCreditEnabled'>): string {
  return card.posCreditEnabled
    ? 'Đưa mã QR này cho thu ngân khi thanh toán tại cửa hàng Tubu để được tích Điểm Xanh.'
    : 'Đây là mã thành viên của bạn. Tích Điểm Xanh khi mua tại cửa hàng chưa được áp dụng — hiện điểm được tích khi mua hàng online.';
}
