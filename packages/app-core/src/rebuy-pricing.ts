import { isFlashRunning, variationPricing, type FlashPriceItem } from './flash-price';
import { serverNow } from './server-clock';

type RebuyItem = { variationId: string; price: number; salePrice?: number | null };

/**
 * Giá của đúng phân loại đã mua (gồm Giờ vàng đang chạy của phân loại đó). Kệ Mua lại mở trang chi tiết ở phân loại này (`pinnedVariationId`
 * / `?pv=`), nên giá trên thẻ và giá ở trang là một.
 */
export function rebuyPricing(item: RebuyItem, flash: readonly (FlashPriceItem & { endAt?: string })[], now: number = serverNow()) {
  return variationPricing({ id: item.variationId, retailPrice: item.price, salePrice: item.salePrice }, flash.filter((f) => isFlashRunning(f, now)));
}
