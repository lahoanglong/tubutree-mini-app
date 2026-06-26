/**
 * Suy ra đơn Pancake đã thanh toán (chuyển khoản) hay chưa, từ payload webhook order.
 * Pancake POS đối soát khoản chuyển vào TK ngân hàng shop rồi cập nhật order; payload có thể
 * mang cờ tường minh (is_paid/payment_status) hoặc số tiền đã trả (prepaid/bank_payment).
 * Hàm thuần để test & dễ chỉnh khi xác nhận field thật từ webhook đầu tiên.
 */
export function isPancakeOrderPaid(data: Record<string, unknown>, orderTotal: number): boolean {
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const ps = data['payment_status'];
  if (data['is_paid'] === true || ps === 'paid' || ps === 'PAID' || ps === 1 || ps === '1') return true;
  // prepaid = đã thanh toán trước; bank_payment = tiền chuyển khoản ghi nhận.
  const paid = num(data['prepaid']) + num(data['bank_payment']);
  return orderTotal > 0 && paid >= orderTotal;
}
