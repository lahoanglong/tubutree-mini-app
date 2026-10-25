/**
 * Giá thẻ sản phẩm có Giờ vàng, MỘT quy tắc cho Mini App và web. Giá khách trả = min(giá Giờ vàng, giá đang bán). Giá gạch là
 * giá đang bán trước Giờ vàng khi Giờ vàng thắng (khớp dải Giờ vàng ở Trang chủ), còn lại là giá niêm yết: một sản phẩm không
 * hiện hai mốc gạch hay hai phần trăm khác nhau trên cùng màn hình.
 */
export interface FlashPriceItem {
  productSlug: string;
  variationId: string;
  flashPrice: number;
}

export interface CardPricing {
  /** Giá khách thật sự trả cho một đơn vị (đã gồm Giờ vàng). */
  price: number;
  isFlash: boolean;
  salePct: number;
  /** Giá gạch; null = không gạch. */
  compareAt: number | null;
  /** Có Giờ vàng cho sản phẩm này, dù không rẻ hơn: trang chi tiết mở đúng phân loại đang giảm. */
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

export function cardPricing(
  product: { slug: string; basePrice: number; salePrice?: number | null },
  flash: readonly FlashPriceItem[],
): CardPricing {
  const item = flash.find((f) => f.productSlug === product.slug);
  const standing = product.salePrice ?? product.basePrice;
  const price = item && item.flashPrice < standing ? item.flashPrice : standing;
  const isFlash = price !== standing;
  const view = discountView(price, isFlash ? standing : product.basePrice);
  return { price, isFlash, salePct: view.salePct, compareAt: view.compareAt, flashVariationId: item?.variationId };
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
