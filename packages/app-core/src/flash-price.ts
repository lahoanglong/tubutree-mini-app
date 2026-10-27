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
 * Một suất Giờ vàng chỉ thắng khi rẻ hơn cả giá đang bán của chính phân loại có suất lẫn giá đang bán của thẻ. Sản phẩm có nhiều
 * suất thì xét hết, lấy suất có `flashPrice` thấp nhất; hoà thì suất của phân loại đại diện (`repVariationId` của thẻ nếu API trả, không thì
 * suất có giá giống thẻ), rồi `variationId`. Thắng thì thẻ dùng giá niêm yết và giá đang bán của phân loại Giờ vàng (như dải Giờ
 * vàng và trang chi tiết mở ở phân loại đó) và trả `flashVariationId`. Không suất nào thắng thì thẻ giữ giá phân loại đại diện,
 * không nhãn Giờ vàng, không `flashVariationId`.
 */
export function cardPricing(
  product: { slug: string; basePrice: number; salePrice?: number | null; repVariationId?: string; pinnedVariationId?: string },
  allFlash: readonly FlashPriceItem[],
): CardPricing {
  // Món gian hàng CTV ghim một phân loại: thẻ chỉ xét Giờ vàng của chính phân loại đó, để giá thẻ và phân loại mở ra luôn là một.
  const flash = product.pinnedVariationId ? allFlash.filter((f) => f.variationId === product.pinnedVariationId) : allFlash;
  const cardStanding = product.salePrice ?? product.basePrice;
  const standingOf = (f: FlashPriceItem) => (f.retailPrice != null ? (f.salePrice ?? f.retailPrice) : cardStanding);
  const isRep = (f: FlashPriceItem) =>
    product.repVariationId != null
      ? f.variationId === product.repVariationId
      : f.retailPrice == null || (f.retailPrice === product.basePrice && standingOf(f) === cardStanding);
  const item = flash
    .filter((f) => f.productSlug === product.slug && f.flashPrice < standingOf(f) && f.flashPrice < cardStanding)
    .sort(
      (a, b) =>
        a.flashPrice - b.flashPrice ||
        Number(isRep(b)) - Number(isRep(a)) ||
        (a.variationId < b.variationId ? -1 : a.variationId > b.variationId ? 1 : 0),
    )[0];
  if (item) {
    const view = discountView(item.flashPrice, standingOf(item));
    return { price: item.flashPrice, isFlash: true, salePct: view.salePct, compareAt: view.compareAt, flashVariationId: item.variationId };
  }
  const view = discountView(cardStanding, product.basePrice);
  return { price: cardStanding, isFlash: false, salePct: view.salePct, compareAt: view.compareAt };
}

/**
 * Phân loại trang chi tiết mở sẵn khi khách không chọn: phân loại đại diện (`pickDefaultVariation`), trừ khi thẻ đang ghi giá Giờ
 * vàng thì phân loại của suất thắng. Thẻ và trang chi tiết dùng chung nên mọi lối vào ra cùng một giá.
 */
export function defaultVariationFor<T extends { id: string; sku?: string; retailPrice: number; salePrice?: number | null; stock: number }>(
  product: { slug: string },
  variations: readonly T[],
  flash: readonly FlashPriceItem[],
): T | undefined {
  const rep = pickDefaultVariation(variations);
  if (!rep) return undefined;
  const { flashVariationId } = cardPricing(
    { slug: product.slug, basePrice: rep.retailPrice, salePrice: rep.salePrice, repVariationId: rep.id },
    flash,
  );
  return (flashVariationId ? variations.find((v) => v.id === flashVariationId && v.stock > 0) : undefined) ?? rep;
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
