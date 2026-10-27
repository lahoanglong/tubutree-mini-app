/**
 * Giá thẻ sản phẩm có Giờ vàng, MỘT quy tắc cho Mini App và web. Giá khách trả = min(giá Giờ vàng, giá đang bán). Giá gạch là
 * giá đang bán trước Giờ vàng khi Giờ vàng thắng (khớp dải Giờ vàng ở Trang chủ), còn lại là giá niêm yết: một sản phẩm không
 * hiện hai mốc gạch hay hai phần trăm khác nhau trên cùng màn hình.
 */
export interface FlashPriceItem {
  productSlug: string;
  variationId: string;
  flashPrice: number;
  /** Giá niêm yết và giá đang bán của chính phân loại có Giờ vàng; thiếu thì thẻ dùng giá của sản phẩm. */
  retailPrice?: number;
  salePrice?: number | null;
}

export interface CardPricing {
  /** Giá khách thật sự trả cho một đơn vị (đã gồm Giờ vàng). */
  price: number;
  isFlash: boolean;
  salePct: number;
  /** Giá gạch; null = không gạch. */
  compareAt: number | null;
  /** Chỉ có khi Giờ vàng thắng trên thẻ: trang chi tiết mở đúng phân loại đang giảm. */
  flashVariationId?: string;
}

/**
 * Giảm giá hiển thị: giá ≤ 0, giá gạch không hợp lệ hoặc không cao hơn giá bán thì coi như không giảm (không gạch, 0%).
 * Phần trăm làm tròn rồi kẹp 1 đến 99: giá chỉ nhích nhẹ không hiện "0%", giá rất thấp không hiện "100%".
 */
export function discountView(price: number, compareAt: number | null | undefined): { compareAt: number | null; salePct: number } {
  if (!Number.isFinite(price) || price <= 0 || compareAt == null || !Number.isFinite(compareAt) || compareAt <= price) {
    return { compareAt: null, salePct: 0 };
  }
  return { compareAt, salePct: Math.min(99, Math.max(1, Math.round((1 - price / compareAt) * 100))) };
}

/**
 * Phân loại mặc định của trang chi tiết: giá đang bán thấp nhất trong các phân loại còn hàng, hoà thì sku rồi id; hết hàng cả
 * thì phân loại đầu theo cùng thứ tự. Thẻ sản phẩm lấy giá của đúng phân loại này (API cũng chọn theo quy tắc đó).
 */
export function pickDefaultVariation<T extends { id: string; sku?: string; retailPrice: number; salePrice?: number | null; stock: number }>(
  variations: readonly T[],
): T | undefined {
  const sorted = [...variations].sort(
    (a, b) =>
      (a.salePrice ?? a.retailPrice) - (b.salePrice ?? b.retailPrice) ||
      ((a.sku ?? '') < (b.sku ?? '') ? -1 : (a.sku ?? '') > (b.sku ?? '') ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return sorted.find((v) => v.stock > 0) ?? sorted[0];
}

/**
 * Giá thẻ sản phẩm. `basePrice`/`salePrice` của thẻ là giá của phân loại đại diện (API đã chọn, xem `pickDefaultVariation`).
 * Giờ vàng chỉ thắng khi rẻ hơn cả giá đang bán của chính phân loại có Giờ vàng lẫn giá đang bán của thẻ; khi đó thẻ dùng giá niêm yết
 * và giá đang bán của phân loại Giờ vàng (như dải Giờ vàng và trang chi tiết mở ở phân loại đó) và trả `flashVariationId`. Không thắng
 * thì thẻ giữ giá phân loại đại diện, không nhãn Giờ vàng, không `flashVariationId`: trang chi tiết mở ở phân loại mặc định.
 */
export function cardPricing(
  product: { slug: string; basePrice: number; salePrice?: number | null },
  flash: readonly FlashPriceItem[],
): CardPricing {
  const item = flash.find((f) => f.productSlug === product.slug);
  const cardStanding = product.salePrice ?? product.basePrice;
  const flashStanding = item && item.retailPrice != null ? (item.salePrice ?? item.retailPrice) : cardStanding;
  if (item && item.flashPrice < flashStanding && item.flashPrice < cardStanding) {
    const view = discountView(item.flashPrice, flashStanding);
    return { price: item.flashPrice, isFlash: true, salePct: view.salePct, compareAt: view.compareAt, flashVariationId: item.variationId };
  }
  const view = discountView(cardStanding, product.basePrice);
  return { price: cardStanding, isFlash: false, salePct: view.salePct, compareAt: view.compareAt };
}

export interface VariationPricingResult {
  price: number;
  isFlash: boolean;
  salePct: number;
  compareAt: number | null;
  endAt?: string;
}

/** Giá một phân loại ở trang chi tiết, cùng quy tắc gạch với thẻ: Giờ vàng thắng thì gạch giá đang bán, ngược lại gạch giá niêm yết. */
export function variationPricing(
  v: { id: string; retailPrice: number; salePrice?: number | null },
  flash: readonly (FlashPriceItem & { endAt?: string })[],
): VariationPricingResult {
  const item = flash.find((f) => f.variationId === v.id);
  const standing = v.salePrice ?? v.retailPrice;
  const isFlash = !!item && item.flashPrice < standing;
  const price = isFlash ? item!.flashPrice : standing;
  const view = discountView(price, isFlash ? standing : v.retailPrice);
  return { price, isFlash, salePct: view.salePct, compareAt: view.compareAt, ...(isFlash && item!.endAt ? { endAt: item!.endAt } : {}) };
}

/**
 * Giá và phần trăm của một suất Giờ vàng (dải Giờ vàng ở Trang chủ). Giá khách trả = min(giá Giờ vàng, giá đang bán); giá niêm yết
 * hạ sau khi tạo đợt thì Giờ vàng không còn rẻ hơn: không hiện phần trăm âm hay giá gạch thấp hơn giá bán. Phần trăm kẹp như `discountView`.
 */
export function flashDisplay(item: { flashPrice: number; retailPrice: number; salePrice?: number | null }) {
  const was = item.salePrice ?? item.retailPrice;
  const price = Math.min(item.flashPrice, was);
  return { price, was, pct: discountView(price, was).salePct };
}
