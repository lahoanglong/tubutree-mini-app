/** Phần trăm hiển thị: nguyên, kẹp 0–100; số lạ (NaN, Infinity) → 0. */
export function clampPercent(pct: number): number {
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 0;
}

/** "Đã bán %" của một suất giờ vàng. Bán quá suất, suất 0 hoặc số lạ không được in ra 150%, NaN%. */
export function soldPercent(sold: number, quota: number): number {
  return quota > 0 ? clampPercent((sold / quota) * 100) : 0;
}

/**
 * Giá khách thực trả = min(giá flash, giá đang bán), như giỏ hàng và trang sản phẩm. Giá niêm yết hạ sau khi tạo đợt
 * thì flash không còn rẻ hơn: không hiện % âm hay giá gạch thấp hơn giá bán.
 */
export function flashDisplay(item: { flashPrice: number; retailPrice: number; salePrice?: number | null }) {
  const was = item.salePrice ?? item.retailPrice;
  const price = Math.min(item.flashPrice, was);
  const pct = was > 0 ? Math.round((1 - price / was) * 100) : 0;
  return { price, was, pct };
}
