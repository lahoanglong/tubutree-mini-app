'use client';

import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { pickCardFlash, productCardView } from '@tubutree/app-core/commerce/product-card-view';
import { useFlashNow } from './flash-now';
import { useFlashListExpiry } from './use-flash-expiry';
import { useActiveFlashSales } from './use-flash-sales';

export interface CardPricing {
  /** Giá khách trả đúng như thẻ đang hiện (Giờ vàng thắng thì giá Giờ vàng). */
  price: number;
  /** Giá gạch của thẻ; null = không gạch. */
  compareAt: number | null;
  /** Phân loại vào giỏ khi thêm từ thẻ: phân loại của suất Giờ vàng đang áp, không thì phân loại gian hàng ghim, không thì phân loại đại diện của thẻ. */
  variationId: string | undefined;
}

/**
 * Giá và phân loại mà một thẻ sản phẩm đang hiện, cùng luật với `ProductCard` (cùng kho Giờ vàng và đồng hồ): nơi cần "thêm đúng món thẻ đang bán đúng giá thẻ"
 * (nút thêm giỏ của Reel, dải gợi ý bù đơn của Giỏ) dùng hàm này để giá trên nút khớp giá thẻ và phân loại thêm vào là phân loại mang giá đó.
 */
export function useCardPricing(): (card: ProductCard) => CardPricing {
  const flash = useActiveFlashSales();
  const now = useFlashNow();
  useFlashListExpiry(flash);
  return (card) => {
    const pick = pickCardFlash(card, flash, now);
    const view = productCardView({ product: card, flash: pick, variant: 'rail-sm', now });
    return { price: view.price, compareAt: view.compareAt, variationId: pick?.variationId ?? card.pinnedVariationId ?? card.repVariationId };
  };
}
