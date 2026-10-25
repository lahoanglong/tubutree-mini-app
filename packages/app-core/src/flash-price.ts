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

export function cardPricing(
  product: { slug: string; basePrice: number; salePrice?: number | null },
  flash: readonly FlashPriceItem[],
): CardPricing {
  const item = flash.find((f) => f.productSlug === product.slug);
  const standing = product.salePrice ?? product.basePrice;
  const price = item && item.flashPrice < standing ? item.flashPrice : standing;
  const isFlash = price !== standing;
  const compareAt = isFlash ? standing : price < product.basePrice ? product.basePrice : null;
  return {
    price,
    isFlash,
    salePct: compareAt ? Math.round((1 - price / compareAt) * 100) : 0,
    compareAt,
    flashVariationId: item?.variationId,
  };
}
