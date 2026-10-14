import { distributeByWeight } from '../orders/refund-allocation';

/**
 * Tiền khách thực trả từng dòng hàng: tiền hàng thực trả (`total − shippingFee`) chia theo giá trị dòng — cùng tỉ lệ
 * paidLineTotals/refund-allocation dùng cho hoa hồng và hoàn tiền, nhưng chia phần dư cho phần lẻ lớn nhất nên cộng lại đúng
 * bằng số khách trả. Ví Tubu là cách trả nên không làm giảm `total`.
 */
export function paidGoodsByLine(order: { total: number; shippingFee: number; items: { total: number }[] }): number[] {
  const totals = order.items.map((i) => Math.max(0, i.total));
  const gross = totals.reduce((s, v) => s + v, 0);
  const paid = Math.max(0, order.total - Math.max(0, order.shippingFee));
  if (paid >= gross) return totals;
  return distributeByWeight(paid, totals);
}

/**
 * Nền tiền hàng của từng dòng trên phiếu đối soát, dùng chung cho đơn gian hàng tự giao và hàng Tubu giao hộ — chỗ DUY NHẤT
 * quyết định nền tính. Hiện là tiền khách thực trả cho dòng: mã giảm giá Tubu, Điểm Xanh, giảm hạng chia theo giá trị dòng và
 * gian hàng chịu. Phần dư chia theo thứ tự id dòng nên số không đổi theo thứ tự DB trả về; kết quả theo đúng thứ tự `items`.
 */
export function merchantLineBase(order: { total: number; shippingFee: number; items: { id: string; total: number }[] }): number[] {
  const sorted = order.items.map((it, idx) => ({ it, idx })).sort((a, b) => a.it.id.localeCompare(b.it.id));
  const shares = paidGoodsByLine({ ...order, items: sorted.map((x) => x.it) });
  const out = new Array<number>(order.items.length).fill(0);
  sorted.forEach((x, k) => {
    out[x.idx] = shares[k] ?? 0;
  });
  return out;
}
