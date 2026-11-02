import { fillCopy } from '../shop-copy';
import { variationPricing, type FlashPriceItem, type VariationPricingResult } from '../flash-price';

export interface FlashLinePreview {
  /** Đơn giá máy chủ sẽ tính cho CẢ dòng giỏ sau khi thêm (số có sẵn trong giỏ + số thêm). */
  unitPrice: number;
  /** Số lượng của dòng giỏ sau khi thêm: `inCart + quantity`. */
  lineQuantity: number;
  /** Số đã có trong giỏ của đúng phân loại này, đã chuẩn hoá (hữu hạn, nguyên, không âm). */
  inCart: number;
  /** Tiền cả dòng sau khi thêm: số "Mua ngay" thanh toán (Mua ngay chọn cả dòng giỏ của phân loại, không riêng phần vừa thêm). */
  lineTotal: number;
  /** Tiền giỏ tăng thật: giá dòng (có sẵn + thêm) trừ giá dòng (có sẵn), số của nút "Thêm vào giỏ". Giỏ rỗng thì bằng `lineTotal`. */
  total: number;
  /** Mất giá Giờ vàng vì cả dòng giỏ vượt số suất được mua: cả dòng tính giá thường. */
  overLimit: boolean;
}

/** Số đã có trong giỏ: hữu hạn thì lấy phần nguyên không âm; chưa tải giỏ, lỗi hay giá trị lạ thì 0 (coi như giỏ rỗng, không chặn nút). */
function normalizeInCart(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** Số của đúng phân loại trong giỏ (`GET /cart`); giỏ chưa tải, lỗi hoặc không có dòng khớp `variationId` thì 0. */
export function inCartQuantity(lines: readonly { variationId: string; quantity: number }[] | null | undefined, variationId: string): number {
  let sum = 0;
  for (const line of lines ?? []) if (line.variationId === variationId) sum += normalizeInCart(line.quantity);
  return sum;
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
 * Thêm giỏ là `increment` (cart.service `addItem`) và giỏ giá trên cả dòng, nên số lượng đem so với suất là `inCart + quantity`, không riêng `quantity`:
 * giỏ đã có 2 mà thêm 2 với suất 3 thì cả 4 sản phẩm tính giá thường, giỏ tăng `4 × giá thường − 2 × giá Giờ vàng`. Giá dòng không giảm khi thêm nên `total` không âm.
 * `limit` là số suất client biết (`allowance` của máy chủ là min(suất còn lại của đợt, giới hạn mỗi khách trừ số khách đã mua); phần khách đã mua
 * chỉ máy chủ biết), nên chưa biết giới hạn thì coi là đủ suất.
 * `overLimit` chỉ bật khi khách thật sự mất giá rẻ hơn: giá Giờ vàng không thấp hơn giá đang bán thì vượt suất cũng ra cùng một số.
 */
export function flashLinePreview(i: {
  standing: number;
  flashPrice: number | null | undefined;
  quantity: number;
  limit: number | null | undefined;
  inCart?: number | null;
}): FlashLinePreview {
  const limit = flashLimitFor({ perUserLimit: i.limit });
  const inCart = normalizeInCart(i.inCart);
  const lineQuantity = inCart + i.quantity;
  const hasDeal = i.flashPrice != null && i.flashPrice < i.standing;
  const unitFor = (qty: number) => (i.flashPrice == null || (limit !== null && qty > limit) ? i.standing : Math.min(i.flashPrice, i.standing));
  const unitPrice = unitFor(lineQuantity);
  const lineTotal = unitPrice * lineQuantity;
  return { unitPrice, lineQuantity, inCart, lineTotal, total: lineTotal - unitFor(inCart) * inCart, overLimit: hasDeal && limit !== null && lineQuantity > limit };
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

/** Một phân loại ở trang chi tiết và bảng chọn: ghép giá hiển thị (`variationPricing`) với tiền dòng theo luật máy chủ; `inCart` là số đã có trong giỏ của phân loại này (`inCartQuantity`). */
export function variationLinePreview(
  v: { id: string; retailPrice: number; salePrice?: number | null },
  flash: readonly FlashPriceItem[],
  quantity: number,
  inCart?: number | null,
): VariationLinePreview {
  const pricing = variationPricing(v, flash);
  const item = pricing.isFlash ? flash.find((f) => f.variationId === v.id) : undefined;
  const limit = flashLimitFor(item);
  const quotaLeft = flashQuotaLeftFor(item);
  const byQuota = quotaLeft !== null && (limit === null || quotaLeft < limit);
  const allowance = byQuota ? quotaLeft : limit;
  const line = flashLinePreview({ standing: v.salePrice ?? v.retailPrice, flashPrice: item?.flashPrice, quantity, limit: allowance, inCart });
  return { ...line, pricing, limit, allowance, allowanceBy: allowance === null ? null : byQuota ? 'quota' : 'perUser' };
}

/**
 * Câu ghi chú "mua quá số suất thì cả dòng tính giá thường" cho số lượng đang chọn; null khi không vượt (không đổi giá nên không nói).
 * Giỏ đã có sẵn phân loại thì nói theo giỏ ("Giỏ đã có n"): khách chọn qty nhưng dòng giỏ thành `inCart + qty` nên con số của họ không phải số bị so với suất.
 * Giỏ đã vượt suất từ trước (`inCart > allowance`) thì dòng giỏ tính giá thường rồi: câu riêng, không nói như thể phần thêm làm mất giá.
 */
export function overLimitNote(
  line: Pick<VariationLinePreview, 'overLimit' | 'allowance' | 'allowanceBy' | 'inCart' | 'lineQuantity'>,
  quantity: number,
): string | null {
  if (!line.overLimit || line.allowance === null) return null;
  if (line.inCart > line.allowance) return fillCopy('flash.sheetOverInCartAlready', { n: line.inCart, allowance: line.allowance });
  if (line.inCart > 0) return fillCopy('flash.sheetOverInCart', { n: line.inCart, qty: quantity, total: line.lineQuantity });
  return fillCopy(line.allowanceBy === 'quota' ? 'flash.sheetOverQuota' : 'flash.sheetOverLimit', { n: line.allowance, qty: quantity });
}

/**
 * Câu báo trước khi bấm "Mua ngay" khi giỏ đã có sẵn phân loại: nút ghi tiền CẢ dòng giỏ (`lineTotal`, số có sẵn + số thêm), không riêng phần
 * khách vừa chọn, nên khách thấy số lớn hơn `qty × đơn giá` cần một câu giải thích. Giỏ chưa có phân loại này thì null.
 */
export function buyNowMergeNote(line: Pick<FlashLinePreview, 'inCart' | 'lineQuantity'>): string | null {
  return line.inCart > 0 ? fillCopy('flash.sheetBuyMerge', { n: line.inCart, total: line.lineQuantity }) : null;
}

/**
 * Chữ duy nhất của vùng ghi chú dưới ô Số lượng: mất giá Giờ vàng thì nói điều đó (nút đã ghi đúng số), không thì nếu `buyNow` (nơi có nút
 * "Mua ngay") và giỏ đã có sẵn thì nói "Mua ngay" thanh toán cả dòng. Hai câu không cùng hiện để vùng giữ chỗ không phải cao hơn.
 */
export function lineNote(
  line: Pick<VariationLinePreview, 'overLimit' | 'allowance' | 'allowanceBy' | 'inCart' | 'lineQuantity'>,
  quantity: number,
  buyNow: boolean,
): string | null {
  return overLimitNote(line, quantity) ?? (buyNow ? buyNowMergeNote(line) : null);
}
