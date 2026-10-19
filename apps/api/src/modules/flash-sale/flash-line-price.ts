import type { EffectivePrice } from './flash-sale.service';

export const FLASH_OWN_SALE_NOTICE = 'Bạn tạo sale này nên không mua được giá flash.';

/** Lý do dòng giờ vàng đang tính giá thường: người mua là người tạo đợt, hoặc số lượng vượt số suất còn mua được. */
export function flashLimitMessage(offer: EffectivePrice, quantity: number): string {
  if (offer.ownSale) return FLASH_OWN_SALE_NOTICE;
  const allowance = offer.allowance ?? 0;
  if (allowance <= 0) return 'Bạn đã dùng hết suất giờ vàng của sản phẩm này, sản phẩm đang tính giá thường.';
  const tail = `Giảm số lượng còn ${allowance} để được giá giờ vàng, hoặc mua ${quantity} sản phẩm với giá thường.`;
  if ((offer.quotaLeft ?? allowance) <= (offer.perUserLeft ?? allowance)) return `Chỉ còn ${allowance} suất giờ vàng. ${tail}`;
  return `Giá giờ vàng chỉ áp dụng tối đa ${allowance} sản phẩm cho bạn. ${tail}`;
}

export interface FlashLinePrice {
  unitPrice: number;
  /** Suất giờ vàng của dòng; null = giá thường. Đặt đơn trừ suất này trong transaction (FlashSaleService.consumeQuotas). */
  flash: EffectivePrice | null;
  flashLimitNotice: string | null;
}

/**
 * Đơn giá một dòng: một luật cho giỏ của khách và đơn CTV lên hộ. Giờ vàng còn suất và số lượng không vượt số suất người mua
 * còn mua được → min(giá giờ vàng, giá đang bán); vượt → cả dòng giá thường kèm lý do. `offer` tra theo người mua
 * (FlashSaleService.resolveEffective với userId) để có `allowance`.
 */
export function priceFlashLine(standing: number, quantity: number, offer: EffectivePrice | undefined): FlashLinePrice {
  const fits = !offer || offer.allowance === undefined || quantity <= offer.allowance;
  const flash = fits ? (offer ?? null) : null;
  return {
    unitPrice: flash ? Math.min(flash.flashPrice, standing) : standing,
    flash,
    flashLimitNotice: offer && !fits ? flashLimitMessage(offer, quantity) : null,
  };
}
