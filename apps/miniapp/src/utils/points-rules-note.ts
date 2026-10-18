import { pointExpiryPolicyNote } from './points-lots';

/**
 * Ghi chú luật dùng điểm ở Kho quà. Trần % tính trên giá trị hàng Tubu của đơn (sau giảm giá, không gồm hàng đại lý: pointsRedeemBase) và khoản trừ không bao giờ
 * chạm phí ship (PricingService.resolvePointsRedemptionByLot); chỉ lô điểm thường chịu trần và hết hạn.
 * Thiếu cấu hình từ máy chủ thì bỏ vế đó thay vì đoán con số.
 */
export function pointsRulesNote(loyalty: { maxRedeemPct?: number; pointExpireMonths?: number } | undefined): string | null {
  const parts: string[] = [];
  const pct = loyalty?.maxRedeemPct;
  if (typeof pct === 'number' && Number.isFinite(pct) && pct > 0 && pct <= 1) {
    parts.push(`Điểm Xanh thường dùng tối đa ${Math.round(pct * 100)}% giá trị hàng Tubu trong đơn, không trừ vào phí ship.`);
  }
  const expiry = pointExpiryPolicyNote(loyalty?.pointExpireMonths);
  if (expiry) parts.push(expiry);
  return parts.length > 0 ? parts.join(' ') : null;
}
