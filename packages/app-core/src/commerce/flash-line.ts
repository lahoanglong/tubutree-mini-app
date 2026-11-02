import { fillCopy } from '../shop-copy';
import { variationPricing, type FlashPriceItem, type VariationPricingResult } from '../flash-price';

export interface FlashLinePreview {
  /** Đơn giá máy chủ sẽ tính cho dòng với số lượng này. */
  unitPrice: number;
  total: number;
  /** Mất giá Giờ vàng vì mua quá số suất được mua: cả dòng tính giá thường. */
  overLimit: boolean;
}

/** Giới hạn mua mỗi khách client biết (`perUserLimit` của suất); không phải số, 0 hoặc âm thì chưa biết giới hạn. */
export function flashLimitFor(item: { perUserLimit?: number | null } | null | undefined): number | null {
  const n = item?.perUserLimit;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Số suất còn lại của đợt theo danh sách client đang giữ (`quota - soldCount`, máy chủ tính `quotaLeft` cùng công thức). Thiếu số hoặc đã hết thì null:
 * danh sách Giờ vàng của máy chủ không trả suất đã hết, nên một suất hết ở client chỉ là danh sách cũ và máy chủ sẽ tính lại giá lúc thêm vào giỏ.
 */
export function flashQuotaLeftFor(item: { quota?: number | null; soldCount?: number | null } | null | undefined): number | null {
  const { quota, soldCount } = item ?? {};
  if (typeof quota !== 'number' || typeof soldCount !== 'number' || !Number.isFinite(quota) || !Number.isFinite(soldCount)) return null;
  const left = quota - soldCount;
  return left > 0 ? left : null;
}

/**
 * Tiền một dòng theo đúng luật `priceFlashLine` của máy chủ (apps/api/src/modules/flash-sale/flash-line-price.ts, spec đối chiếu cả hai):
 * số lượng ≤ suất thì đơn giá = min(giá Giờ vàng, giá đang bán); vượt thì CẢ DÒNG giá đang bán, không chia đôi.
 * `limit` là số suất client biết (`allowance` của máy chủ là min(suất còn lại của đợt, giới hạn mỗi khách trừ số khách đã mua); phần khách đã mua
 * chỉ máy chủ biết), nên chưa biết giới hạn thì coi là đủ suất.
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
  /** Giới hạn mỗi khách của suất đang áp cho phân loại ("Tối đa n/khách"); null khi không đang Giờ vàng hoặc client chưa biết. */
  limit: number | null;
  /** Số suất client biết là còn mua được giá Giờ vàng: min(giới hạn mỗi khách, suất còn lại của đợt); null khi không đang Giờ vàng hoặc không biết số nào. */
  allowance: number | null;
  /** Số nào đang chặn: giới hạn của riêng khách, hay đợt sắp hết suất (ít hơn giới hạn của khách). */
  allowanceBy: 'perUser' | 'quota' | null;
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
  const quotaLeft = flashQuotaLeftFor(item);
  const byQuota = quotaLeft !== null && (limit === null || quotaLeft < limit);
  const allowance = byQuota ? quotaLeft : limit;
  const line = flashLinePreview({ standing: v.salePrice ?? v.retailPrice, flashPrice: item?.flashPrice, quantity, limit: allowance });
  return { ...line, pricing, limit, allowance, allowanceBy: allowance === null ? null : byQuota ? 'quota' : 'perUser' };
}

/** Câu ghi chú "mua quá số suất thì cả dòng tính giá thường" cho số lượng đang chọn; null khi không vượt (không đổi giá nên không nói). */
export function overLimitNote(line: Pick<VariationLinePreview, 'overLimit' | 'allowance' | 'allowanceBy'>, quantity: number): string | null {
  if (!line.overLimit || line.allowance === null) return null;
  return fillCopy(line.allowanceBy === 'quota' ? 'flash.sheetOverQuota' : 'flash.sheetOverLimit', { n: line.allowance, qty: quantity });
}
