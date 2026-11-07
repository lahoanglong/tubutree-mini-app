import { cardPricing, isFlashRunning, variationPricing, type CardPricing, type FlashPriceItem } from '../flash-price';
import { serverNow } from '../server-clock';
import { variationLinePreview } from './flash-line';

/**
 * Giá của MỘT đơn vị khách vừa chạm "thêm" (dải Mua lại món quen, khối Gợi ý mua kèm hợp vị). Giỏ so số suất Giờ vàng với cả dòng (số có sẵn + 1): vượt suất
 * (hết suất đã mua ở đơn trước, hoặc giỏ đã đủ suất) thì CẢ dòng tính giá đang bán, nên thẻ không được ghi giá Giờ vàng mà giỏ không tính.
 */
export interface AddOnePricing {
  price: number;
  compareAt: number | null;
}

/** Một phân loại. `flash` nên mang `perUserLeft` (trộn bằng `withFlashAllowance`); `inCart` là số đã có trong giỏ của đúng phân loại này. */
export function addOneVariationPricing(
  v: { id: string; retailPrice: number; salePrice?: number | null },
  flash: readonly FlashPriceItem[],
  inCart?: number | null,
): AddOnePricing {
  const line = variationLinePreview(v, flash, 1, inCart);
  const pricing = line.overLimit ? variationPricing(v, []) : line.pricing;
  return { price: pricing.price, compareAt: pricing.compareAt };
}

export interface AddOneCardPricing extends AddOnePricing {
  /** Phân loại sẽ vào giỏ: ghim (CTV) > suất Giờ vàng đang thắng trên thẻ > đại diện. */
  variationId: string | null;
  isFlash: boolean;
  salePct: number;
}

/**
 * Một thẻ sản phẩm (giá đại diện hoặc giá Giờ vàng thắng trên thẻ). Thẻ không biết giỏ nên coi như giỏ chưa có phân loại này; nơi gọi đã loại món có trong giỏ.
 * Suất Giờ vàng thắng mà khách hết suất thì thẻ về giá thường và phân loại đại diện (cùng số giỏ sẽ tính).
 */
export function addOneCardPricing(
  card: { slug: string; basePrice: number; salePrice?: number | null; repVariationId?: string; pinnedVariationId?: string },
  flash: readonly FlashPriceItem[],
  now: number = serverNow(),
): AddOneCardPricing {
  const running = flash.filter((f) => isFlashRunning(f, now));
  let pricing: CardPricing = cardPricing(card, running, now);
  if (pricing.isFlash && pricing.flashVariationId) {
    const item = running.find((f) => f.variationId === pricing.flashVariationId);
    const v = {
      id: pricing.flashVariationId,
      retailPrice: item?.retailPrice ?? card.basePrice,
      salePrice: item?.retailPrice != null ? item.salePrice : card.salePrice,
    };
    if (variationLinePreview(v, running, 1, 0).overLimit) pricing = cardPricing(card, [], now);
  }
  return {
    price: pricing.price,
    compareAt: pricing.compareAt,
    variationId: card.pinnedVariationId ?? pricing.flashVariationId ?? card.repVariationId ?? null,
    isFlash: pricing.isFlash,
    salePct: pricing.salePct,
  };
}
