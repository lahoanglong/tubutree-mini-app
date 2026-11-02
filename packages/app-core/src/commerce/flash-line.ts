import { variationPricing, type FlashPriceItem, type VariationPricingResult } from '../flash-price';

export interface FlashLinePreview {
  /** Đơn giá máy chủ sẽ tính cho dòng với số lượng này. */
  unitPrice: number;
  total: number;
  /** Mất giá Giờ vàng vì mua quá giới hạn mỗi khách: cả dòng tính giá thường. */
  overLimit: boolean;
}

/** Giới hạn mua mỗi khách client biết (`perUserLimit` của suất); không phải số, 0 hoặc âm thì chưa biết giới hạn. */
export function flashLimitFor(item: { perUserLimit?: number | null } | null | undefined): number | null {
  const n = item?.perUserLimit;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Tiền một dòng theo đúng luật `priceFlashLine` của máy chủ (apps/api/src/modules/flash-sale/flash-line-price.ts, spec đối chiếu cả hai):
 * số lượng ≤ suất thì đơn giá = min(giá Giờ vàng, giá đang bán); vượt thì CẢ DÒNG giá đang bán, không chia đôi.
 * `limit` là giới hạn mỗi khách client biết; số suất còn lại thật của khách (`allowance`) chỉ máy chủ biết, nên chưa biết giới hạn thì coi là đủ suất.
 * `overLimit` chỉ bật khi khách thật sự mất giá rẻ hơn: giá Giờ vàng không thấp hơn giá đang bán thì vượt suất cũng ra cùng một số.
 */
export function flashLinePreview(i: { standing: number; flashPrice: number | null | undefined; quantity: number; limit: number | null | undefined }): FlashLinePreview {
  const limit = flashLimitFor({ perUserLimit: i.limit });
  const hasDeal = i.flashPrice != null && i.flashPrice < i.standing;
  const over = limit !== null && i.quantity > limit;
  const unitPrice = i.flashPrice == null || over ? i.standing : Math.min(i.flashPrice, i.standing);
  return { unitPrice, total: unitPrice * i.quantity, overLimit: hasDeal && over };
}

export interface VariationLinePreview extends FlashLinePreview {
  /** Giá một đơn vị của phân loại (giá Giờ vàng nếu đang chạy), để vẽ ô giá và nhãn; khác `unitPrice` khi vượt giới hạn. */
  pricing: VariationPricingResult;
  /** Giới hạn mỗi khách của suất đang áp cho phân loại; null khi không đang Giờ vàng hoặc client chưa biết. */
  limit: number | null;
}

/** Một phân loại ở trang chi tiết và bảng chọn: ghép giá hiển thị (`variationPricing`) với tiền dòng theo luật máy chủ. */
export function variationLinePreview(
  v: { id: string; retailPrice: number; salePrice?: number | null },
  flash: readonly FlashPriceItem[],
  quantity: number,
): VariationLinePreview {
  const pricing = variationPricing(v, flash);
  const item = pricing.isFlash ? flash.find((f) => f.variationId === v.id) : undefined;
  const limit = flashLimitFor(item);
  const line = flashLinePreview({ standing: v.salePrice ?? v.retailPrice, flashPrice: item?.flashPrice, quantity, limit });
  return { ...line, pricing, limit };
}
