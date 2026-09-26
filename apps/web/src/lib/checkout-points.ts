/**
 * Điểm Xanh màn thanh toán web được đề nghị dùng: `redeemablePoints` của báo giá (số dư − điểm của đơn
 * còn trong hạn đổi/trả hoặc đang chờ xử lý đổi/trả), KHÔNG phải số dư — CheckoutService kẹp báo giá và
 * đặt đơn đúng theo số này (cùng luật đổi quà Điểm Xanh). API cũ chưa trả field → số dư (backend tự kẹp).
 */
export function checkoutPointsOffer(
  quote: { pointsBalance: number; redeemablePoints?: number; lockedPoints?: number } | undefined,
): { usable: number; lockNote: string | null } {
  if (!quote) return { usable: 0, lockNote: null };
  const balance = Math.max(0, quote.pointsBalance);
  const usable = Math.min(balance, Math.max(0, quote.redeemablePoints ?? balance));
  const held = balance - usable;
  return {
    usable,
    lockNote: held > 0 ? `${held} điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được` : null,
  };
}
