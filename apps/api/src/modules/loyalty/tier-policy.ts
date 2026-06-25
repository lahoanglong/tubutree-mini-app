export interface TierInfo {
  id: string;
  sortOrder: number;
}

export interface TierDecision {
  tierId: string;
  graceUntil: Date | null;
}

/**
 * Quyết định hạng mới có áp dụng "ân hạn rớt hạng" (§6.6, config loyalty.tier_grace_days).
 * - Chưa có hạng → áp hạng đạt được ngay.
 * - Lên hạng / giữ nguyên → áp ngay, xoá grace.
 * - Rớt hạng:
 *    + lần đầu phát hiện (chưa có grace) → GIỮ hạng cũ, đặt graceUntil = now + graceDays.
 *    + còn trong grace → giữ hạng cũ, KHÔNG gia hạn (tránh grace vô tận khi cron chạy mỗi đêm).
 *    + grace đã hết → áp hạng thấp, xoá grace.
 * Hàm THUẦN (không chạm DB) để test dễ và tái dùng cho cả event-driven lẫn cron.
 */
export function decideTier(p: {
  currentTierId: string | null;
  tiers: TierInfo[];
  qualifiedId: string;
  graceUntil: Date | null;
  now: Date;
  graceDays: number;
}): TierDecision {
  const { currentTierId, tiers, qualifiedId, graceUntil, now, graceDays } = p;
  if (!currentTierId) return { tierId: qualifiedId, graceUntil: null };

  const orderOf = (id: string) => tiers.find((t) => t.id === id)?.sortOrder ?? -1;
  const curOrder = orderOf(currentTierId);
  const qualOrder = orderOf(qualifiedId);

  // Lên hạng hoặc giữ nguyên → áp ngay (xoá mọi grace đang treo).
  if (qualOrder >= curOrder) return { tierId: qualifiedId, graceUntil: null };

  // Rớt hạng.
  if (graceUntil == null) {
    return { tierId: currentTierId, graceUntil: new Date(now.getTime() + graceDays * 86400000) };
  }
  if (now.getTime() >= graceUntil.getTime()) return { tierId: qualifiedId, graceUntil: null };
  return { tierId: currentTierId, graceUntil };
}
