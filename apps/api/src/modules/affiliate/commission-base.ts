import { storedLinePaid } from '../orders/refund-allocation';

/**
 * Giá trị từng dòng hàng mà khách THỰC TRẢ — nền tính hoa hồng CTV (SELLER-6, spec flash-sale §"goods sau
 * giảm"). Đơn có `OrderItem.paidTotal` (checkout đã chia mã giảm giá, giảm hạng, Điểm Xanh về đúng dòng được hưởng) dùng
 * đúng số đó — cùng số hoàn tiền và đối soát đối tác dùng. Đơn cũ: `OrderItem.total` chỉ đã trừ combo, phần giảm còn lại
 * chia theo tỉ lệ giá trị dòng: hệ số = tiền hàng thực trả (`total − shippingFee`) / tổng `OrderItem.total`, không bao
 * giờ > 1 (không trả hoa hồng trên phí ship).
 */
export function paidLineTotals<T extends { total: number; paidTotal?: number | null }>(
  order: { total: number; shippingFee?: number | null },
  items: T[],
): number[] {
  const gross = items.reduce((s, i) => s + i.total, 0);
  if (gross <= 0) return items.map(() => 0);
  const paidGoods = Math.max(0, order.total - (order.shippingFee ?? 0));
  const stored = storedLinePaid(paidGoods, items);
  if (stored) return stored;
  if (paidGoods >= gross) return items.map((i) => i.total);
  return items.map((i) => Math.floor((i.total * paidGoods) / gross));
}

/**
 * Hoa hồng đã chi có phần của một trong các dòng bị trả không. `lineAmounts` ghi hoa hồng từng dòng lúc đặt (dòng mức % bằng 0
 * hoặc hoa hồng làm tròn về 0 thì không có phần); hoa hồng cũ chưa lưu thì không biết dòng nào có hoa hồng, coi là có để kế
 * toán không sót.
 */
export function commissionCoversLines(lineAmounts: unknown, lines: { orderItemId: string; quantity: number }[]): boolean {
  if (!lineAmounts || typeof lineAmounts !== 'object' || Array.isArray(lineAmounts)) return true;
  const stored = lineAmounts as Record<string, unknown>;
  return lines.some((l) => l.quantity > 0 && Number(stored[l.orderItemId]) > 0);
}
