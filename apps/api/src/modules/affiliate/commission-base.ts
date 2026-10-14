/**
 * Giá trị từng dòng hàng mà khách THỰC TRẢ — nền tính hoa hồng CTV (SELLER-6, spec flash-sale §"goods sau
 * giảm"). `OrderItem.total` chỉ đã trừ combo; mã giảm giá, giảm hạng và Điểm Xanh nằm gộp ở `Order.discount`.
 * Phân bổ phần giảm còn lại xuống các dòng theo tỉ lệ giá trị dòng: hệ số = tiền hàng thực trả
 * (`total − shippingFee`) / tổng `OrderItem.total`, không bao giờ > 1 (không trả hoa hồng trên phí ship).
 */
export function paidLineTotals<T extends { total: number }>(
  order: { total: number; shippingFee?: number | null },
  items: T[],
): number[] {
  const gross = items.reduce((s, i) => s + i.total, 0);
  if (gross <= 0) return items.map(() => 0);
  const paidGoods = Math.max(0, order.total - (order.shippingFee ?? 0));
  if (paidGoods >= gross) return items.map((i) => i.total);
  return items.map((i) => Math.floor((i.total * paidGoods) / gross));
}
