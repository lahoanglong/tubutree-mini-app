import { variationLinePreview } from './commerce/flash-line';
import { isFlashRunning, variationPricing, type FlashPriceItem } from './flash-price';
import { serverNow } from './server-clock';

type RebuyItem = { variationId: string; price: number; salePrice?: number | null; flashAllowance?: number | null };

/**
 * Giá của đúng phân loại đã mua (gồm Giờ vàng đang chạy của phân loại đó khi khách vẫn còn suất mua).
 * Hết suất (`flashAllowance === 0` hoặc thêm 1 vượt giới hạn của suất/đợt) thì trả giá thường như giỏ và `ReorderSheet` sẽ tính.
 */
export function rebuyPricing(
  item: RebuyItem,
  flash: readonly FlashPriceItem[],
  now: number = serverNow(),
  inCart = 0,
) {
  const running = flash.filter((f) => f.variationId === item.variationId && isFlashRunning(f, now));
  const apiBlocked = item.flashAllowance != null && 1 + inCart > item.flashAllowance;
  const overLimit = variationLinePreview({ id: item.variationId, retailPrice: item.price, salePrice: item.salePrice }, running, 1, inCart).overLimit;
  return variationPricing({ id: item.variationId, retailPrice: item.price, salePrice: item.salePrice }, apiBlocked || overLimit ? [] : running);
}
