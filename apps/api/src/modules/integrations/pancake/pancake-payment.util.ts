import { payloadNumericString } from './pancake-payload';

/** Số tiền của một ô: số hữu hạn trong miền an toàn, hoặc chuỗi số thập phân (không phải mẫu ngăn nghìn "269.000"); null khi không đọc được. */
const readMoney = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? payloadNumericString(v) : null;
  return n !== null && Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : null;
};

/** Ô tiền đọc được, không thì 0 (Number(true) = 1, Number([5]) = 5 là kiểu đọc sai mà hàm này tránh). */
const num = (v: unknown): number => readMoney(v) ?? 0;

/** Các ô tiền đã trả của payload đơn. */
const PAID_FIELDS = ['prepaid', 'bank_payment'] as const;

/** Tên các ô tiền đã trả có mặt (khác null/undefined/'') mà không đọc được: người gọi ghi warn để biết vì sao đơn không được tính đã trả. */
export function unreadablePaidFields(data: Record<string, unknown>): string[] {
  return PAID_FIELDS.filter((f) => {
    const v = data[f];
    return v !== undefined && v !== null && v !== '' && readMoney(v) === null;
  });
}

/** Số tiền Pancake ghi nhận khách đã trả (prepaid + bank_payment); 0 khi payload chỉ có cờ is_paid. */
export function pancakePaidAmount(data: Record<string, unknown>): number {
  return Math.max(0, Math.round(num(data['prepaid']) + num(data['bank_payment'])));
}

/**
 * Số Pancake báo đã trả của đơn ĐÃ nhận đủ tiền từ trước, để dò khách trả dư. Khi đơn đã thanh toán, Tubu tự ghi
 * transfer_money = số phải thu lên Pancake (PancakeOrderService.syncPayment) và Pancake có thể phản ánh nó vào `prepaid`
 * bên cạnh khoản chuyển khoản nhân viên ghi ở `bank_payment` — cộng hai ô là đếm một lần chuyển hai lần. Lấy ô lớn hơn:
 * vượt tổng đơn chỉ khi chính một ô đã vượt. Chưa đối chiếu được hợp đồng field thật của Pancake nên kết quả chỉ là tín hiệu
 * cho admin đối soát, không phải khoản khách tự rút được.
 */
export function pancakePaidAmountAfterPaid(data: Record<string, unknown>): number {
  return Math.max(0, Math.round(Math.max(num(data['prepaid']), num(data['bank_payment']))));
}

/**
 * Suy ra đơn Pancake đã thanh toán (chuyển khoản) hay chưa, từ payload webhook order.
 * Pancake POS đối soát khoản chuyển vào TK ngân hàng shop rồi cập nhật order; payload có thể
 * mang cờ tường minh (is_paid/payment_status) hoặc số tiền đã trả (prepaid/bank_payment).
 * Hàm thuần để test & dễ chỉnh khi xác nhận field thật từ webhook đầu tiên.
 */
export function isPancakeOrderPaid(data: Record<string, unknown>, orderTotal: number): boolean {
  const ps = data['payment_status'];
  if (data['is_paid'] === true || ps === 'paid' || ps === 'PAID' || ps === 1 || ps === '1') return true;
  // prepaid = đã thanh toán trước; bank_payment = tiền chuyển khoản ghi nhận.
  return orderTotal > 0 && pancakePaidAmount(data) >= orderTotal;
}
