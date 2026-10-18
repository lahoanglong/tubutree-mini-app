import { pointExpiryPolicyNote } from './points-lots';

/**
 * Ghi chú luật dùng điểm ở Kho quà. Trần % tính trên giá trị HÀNG của đơn (sau giảm giá) và khoản trừ không bao giờ
 * chạm phí ship (PricingService.resolvePointsRedemptionByLot); chỉ lô điểm thường chịu trần và hết hạn.
 * Thiếu cấu hình từ máy chủ thì bỏ vế đó thay vì đoán con số.
 */
export function pointsRulesNote(loyalty: { maxRedeemPct?: number; pointExpireMonths?: number } | undefined): string | null {
  const parts: string[] = [];
  const pct = loyalty?.maxRedeemPct;
  if (typeof pct === 'number' && Number.isFinite(pct) && pct > 0 && pct <= 1) {
    parts.push(`Dùng tối đa ${Math.round(pct * 100)}% giá trị hàng trong đơn, không trừ vào phí ship.`);
  }
  const expiry = pointExpiryPolicyNote(loyalty?.pointExpireMonths);
  if (expiry) parts.push(expiry);
  return parts.length > 0 ? parts.join(' ') : null;
}
