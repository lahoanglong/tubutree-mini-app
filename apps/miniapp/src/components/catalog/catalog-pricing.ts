import { cardPricing } from '@tubutree/app-core/flash-price';
import { serverNow } from '../../utils/server-clock';
import type { FlashSaleActiveItem } from '../../services/shop-api';

export interface TilePricing {
  price: number;
  isFlash: boolean;
  salePct: number;
  /** Giá gạch: giá đang bán trước giờ vàng khi flash thắng, còn lại là giá niêm yết. null = không gạch. */
  compareAt: number | null;
  /** Có flash cho SP này → PDP mở đúng phân loại đang giảm (dù flash không rẻ hơn). */
  flashVariationId?: string;
}

/** Quy tắc giá thẻ dùng chung với web (`cardPricing` ở app-core): Giờ vàng chỉ thắng khi rẻ hơn giá đang bán và gạch giá đang bán. */
export function tilePricing(
  product: { slug: string; basePrice: number; salePrice?: number | null; repVariationId?: string; pinnedVariationId?: string },
  flashSales: FlashSaleActiveItem[],
): TilePricing {
  return cardPricing(product, flashSales, serverNow());
}

export { flashDisplay } from '@tubutree/app-core/flash-price';
