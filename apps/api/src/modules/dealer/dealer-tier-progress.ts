/** Giờ VN so với UTC (VN không đổi giờ theo mùa). */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Bậc đại lý như lưu trong `dealer_tiers`: `minOrderVolume` là doanh số tiền hàng một tháng để được xét vào bậc. */
export interface TierRow {
  id: string;
  name: string;
  minOrderVolume: number;
  discountRules: unknown;
}

export interface TierView {
  id: string;
  name: string;
  minOrderVolume: number;
  /** Chiết khấu chung của bậc (phần trăm nguyên), đã kẹp theo trần `dealer.max_discount_pct`. */
  discountPct: number;
}

/** Tháng hiện tại theo giờ VN: nhãn "11/2026" và mốc UTC [start, end). */
export function vnMonthBounds(now: Date): { label: string; start: Date; end: Date } {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const year = vn.getUTCFullYear();
  const month = vn.getUTCMonth();
  return {
    label: `${month + 1}/${year}`,
    start: new Date(Date.UTC(year, month, 1) - VN_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - VN_OFFSET_MS),
  };
}

/** Cùng cách `DealerService.dealerContext` đọc chiết khấu: `discountRules.default`, thiếu thì 0,2, kẹp theo trần. */
export function tierDiscountPct(discountRules: unknown, maxDiscount: number): number {
  const raw = (discountRules as { default?: unknown } | null)?.default;
  const pct = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0.2;
  return Math.round(Math.max(0, Math.min(pct, maxDiscount)) * 100);
}

export const tierView = (t: TierRow, maxDiscount: number): TierView => ({
  id: t.id,
  name: t.name,
  minOrderVolume: t.minOrderVolume,
  discountPct: tierDiscountPct(t.discountRules, maxDiscount),
});

/**
 * Bậc kế tiếp của đại lý: bậc có mốc doanh số tháng nhỏ nhất mà vẫn lớn hơn mốc của bậc hiện tại và chiết khấu cao hơn.
 * Bậc chỉ cao mốc mà không giảm thêm thì không phải bậc chiết khấu kế tiếp. Chưa được gán bậc thì không có bậc kế: bậc đầu do Tubu Tree
 * gán lúc duyệt hồ sơ, không theo doanh số.
 */
export function nextTierOf(tiers: TierRow[], current: TierRow | null, maxDiscount: number): TierView | null {
  if (!current) return null;
  const currentPct = tierDiscountPct(current.discountRules, maxDiscount);
  const next = tiers
    .filter((t) => t.id !== current.id && t.minOrderVolume > current.minOrderVolume)
    .map((t) => tierView(t, maxDiscount))
    .filter((t) => t.discountPct > currentPct)
    .sort((a, b) => a.minOrderVolume - b.minOrderVolume || a.id.localeCompare(b.id))[0];
  return next ?? null;
}
