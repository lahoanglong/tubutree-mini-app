import { cardPricing, type FlashPriceItem } from '@tubutree/app-core/flash-price';
import type { ProductCard } from '../services/shop-api';

export interface CardAddTarget {
  /** Phân loại vào giỏ khi chạm thêm nhanh; null khi thẻ không mang phân loại nào (API cũ). */
  variationId: string | null;
  /** Giá khách trả, đúng số thẻ đang ghi (Giờ vàng thắng khi còn hạn). */
  price: number;
  compareAt: number | null;
}

/**
 * Giá và phân loại của nút thêm một chạm trên một thẻ. Dải gợi ý bù đơn của Giỏ dùng cả hai (thêm thẳng không qua chi tiết món); nút "Thêm vào giỏ · giá" của Reel chỉ lấy `price`
 * (phân loại do `quickAddPlan` chọn sau khi tải chi tiết). Món ghim phân loại (CTV) luôn thêm phân loại ghim; Giờ vàng thắng trên thẻ thì thêm phân loại của suất đó
 * (giá thẻ là giá Giờ vàng, thêm phân loại đại diện sẽ ra giá khác); còn lại là phân loại đại diện của thẻ.
 */
export function cardAddTarget(card: ProductCard, flash: readonly FlashPriceItem[], now: number): CardAddTarget {
  const pricing = cardPricing(card, flash, now);
  return {
    variationId: card.pinnedVariationId ?? pricing.flashVariationId ?? card.repVariationId ?? null,
    price: pricing.price,
    compareAt: pricing.compareAt,
  };
}
