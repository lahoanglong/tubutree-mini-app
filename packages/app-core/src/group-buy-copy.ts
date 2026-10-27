import type { GroupBuy } from './api/groupbuy';
import { cardPricing, type FlashPriceItem } from './flash-price';

type PriceFields = Pick<GroupBuy, 'unitPrice' | 'basePrice'> & { product?: { slug: string }; variationId?: string };

/**
 * Mua chung không giảm thẳng giá: nhóm đủ người thì mỗi thành viên nhận một mã giảm, dùng ở giỏ hàng. Thẻ nhóm vì vậy ghi hai giá
 * cạnh nhau (giá nhóm và giá mua một mình), không gạch giá, để khách không đọc giá nhóm như giá đang bán.
 */
export function groupPriceLabels(
  g: PriceFields,
  formatVnd: (n: number) => string,
  flash?: readonly FlashPriceItem[],
  now?: number,
): { group: string; solo: string; soloIsCheaper: boolean } {
  const solo = soloPricing(g, flash, now);
  const soloIsCheaper = solo.price < g.unitPrice;
  const soloText = soloIsCheaper
    ? `${solo.isFlash ? 'Giờ vàng đang rẻ hơn' : 'Giá hiện nay rẻ hơn'}: ${formatVnd(solo.price)}`
    : `Mua một mình ${formatVnd(solo.price)}`;
  return { group: `Giá nhóm ${formatVnd(g.unitPrice)}`, solo: soloText, soloIsCheaper };
}

/**
 * Giá mua một mình hiện nay. `basePrice` của nhóm là giá lúc tạo nhóm (có thể đã cũ tới 48 giờ, trước một đợt Giờ vàng), nên khi trang
 * có danh sách Giờ vàng đang chạy thì tính lại bằng quy tắc giá thẻ (`cardPricing`), chỉ xét Giờ vàng của chính phân loại mà giá nhóm
 * dựa trên (`variationId`; API cũ không trả thì xét mọi phân loại của sản phẩm); chưa có danh sách hoặc không có suất nào thắng
 * thì giữ giá đã lưu. Khi kết quả thấp hơn giá nhóm, nhãn không còn là "Mua một mình" (xem `groupPriceLabels`).
 */
export function soloPricing(g: PriceFields, flash?: readonly FlashPriceItem[], now?: number): { price: number; isFlash: boolean } {
  if (!flash || !g.product) return { price: g.basePrice, isFlash: false };
  const c = cardPricing({ slug: g.product.slug, basePrice: g.basePrice, ...(g.variationId ? { pinnedVariationId: g.variationId } : {}) }, flash, now);
  return { price: c.price, isFlash: c.isFlash };
}

/** Dòng giải thích điều kiện nhận mã: nêu số người cần để đủ nhóm. */
export function groupRewardLine(g: Pick<GroupBuy, 'targetSize' | 'discountPct' | 'unitPrice' | 'minOrder'>, formatVnd: (n: number) => string): string {
  return `Đủ ${g.targetSize} người: mỗi người nhận mã giảm ${g.discountPct}%, dùng cho đơn từ ${formatVnd(g.minOrder ?? g.unitPrice)}`;
}

/** Số người còn thiếu để đủ nhóm, không âm. */
export function groupMissing(g: Pick<GroupBuy, 'targetSize' | 'currentSize'>): number {
  return Math.max(0, g.targetSize - g.currentSize);
}

/** Chữ trạng thái của người đã ở trong nhóm đang mở; nút chính lúc đó là "Mời bạn bè" nên không còn nút "Nhóm của bạn" bị mờ. */
export function groupMemberStatus(g: Pick<GroupBuy, 'targetSize' | 'currentSize'>): string {
  const need = groupMissing(g);
  return need > 0 ? `Bạn đã ở trong nhóm · cần thêm ${need} người` : 'Bạn đã ở trong nhóm';
}
