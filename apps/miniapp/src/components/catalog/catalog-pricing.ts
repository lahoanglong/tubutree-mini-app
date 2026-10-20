import type { FlashSaleActiveItem, ProductCard } from '../../services/shop-api';

export interface TilePricing {
  price: number;
  isFlash: boolean;
  salePct: number;
  /** Giá gạch: giá đang bán trước giờ vàng khi flash thắng, còn lại là giá niêm yết. null = không gạch. */
  compareAt: number | null;
  /** Có flash cho SP này → PDP mở đúng phân loại đang giảm (dù flash không rẻ hơn). */
  flashVariationId?: string;
}

/** Quy tắc giá thẻ — y hệt ProductCard cũ + RelatedTile ở PDP (flash chỉ thắng khi rẻ hơn giá đang bán). */
export function tilePricing(
  product: Pick<ProductCard, 'slug' | 'basePrice' | 'salePrice'>,
  flashSales: FlashSaleActiveItem[],
): TilePricing {
  const flash = flashSales.find((f) => f.productSlug === product.slug);
  const standing = product.salePrice ?? product.basePrice;
  const price = flash && flash.flashPrice < standing ? flash.flashPrice : standing;
  const isFlash = price !== standing;
  // Giờ vàng so với giá đang bán (khớp dải trang chủ), không so với giá niêm yết: một SP không được hiện hai mốc gạch/hai % khác nhau.
  const compareAt = isFlash ? standing : price < product.basePrice ? product.basePrice : null;
  return {
    price,
    isFlash,
    salePct: compareAt ? Math.round((1 - price / compareAt) * 100) : 0,
    compareAt,
    flashVariationId: flash?.variationId,
  };
}

/**
 * Giá của dải giờ vàng ở trang chủ. Giá khách thực trả = min(giá flash, giá đang bán), như giỏ hàng và trang sản phẩm. Giá niêm yết
 * hạ sau khi tạo đợt thì flash không còn rẻ hơn: không hiện % âm hay giá gạch thấp hơn giá bán.
 */
export function flashDisplay(item: { flashPrice: number; retailPrice: number; salePrice?: number | null }) {
  const was = item.salePrice ?? item.retailPrice;
  const price = Math.min(item.flashPrice, was);
  const pct = was > 0 ? Math.round((1 - price / was) * 100) : 0;
  return { price, was, pct };
}
