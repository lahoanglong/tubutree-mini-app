import type { GroupBuy } from './api/groupbuy';

type PriceFields = Pick<GroupBuy, 'unitPrice' | 'basePrice'>;

/**
 * Mua chung không giảm thẳng giá: nhóm đủ người thì mỗi thành viên nhận một mã giảm, dùng ở giỏ hàng. Thẻ nhóm vì vậy ghi hai giá
 * cạnh nhau (giá nhóm và giá mua một mình), không gạch giá, để khách không đọc giá nhóm như giá đang bán.
 */
export function groupPriceLabels(g: PriceFields, formatVnd: (n: number) => string): { group: string; solo: string } {
  return { group: `Giá nhóm ${formatVnd(g.unitPrice)}`, solo: `Mua một mình ${formatVnd(g.basePrice)}` };
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
