import type { FlashSaleActiveItem, ProductCard } from '../../services/shop-api';

export interface TilePricing {
  price: number;
  isFlash: boolean;
  salePct: number;
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
  const hasSale = price < product.basePrice;
  return {
    price,
    isFlash: price !== standing,
    salePct: hasSale ? Math.round((1 - price / product.basePrice) * 100) : 0,
    flashVariationId: flash?.variationId,
  };
}
