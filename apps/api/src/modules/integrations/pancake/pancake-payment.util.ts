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
  if (hasPancakePaidFlag(data)) return true;
  // prepaid = đã thanh toán trước; bank_payment = tiền chuyển khoản ghi nhận.
  return orderTotal > 0 && pancakePaidAmount(data) >= orderTotal;
}

/** Cờ "đã thanh toán" tường minh (is_paid/payment_status), không xét ô số tiền. */
function hasPancakePaidFlag(data: Record<string, unknown>): boolean {
  const ps = data['payment_status'];
  return data['is_paid'] === true || ps === 'paid' || ps === 'PAID' || ps === 1 || ps === '1';
}

/**
 * Trạng thái đơn Pancake cho biết hãng đã giao tới khách và thu COD: 3 "Đã nhận", 16 "Đã thu tiền", 15 "Hoàn một phần" (khách giữ một phần, hãng thu COD
 * phần đó; đơn Tubu không đổi trạng thái theo mã này). Cùng bảng mã với pancake-status.map.
 */
const DELIVERED_STATUSES: ReadonlySet<string> = new Set(['3', '15', '16', 'delivered', 'completed']);

/** Đơn Tubu đã đóng mà không giao: cờ "đã trả" trơn không phải dấu chuyển khoản lúc hàng đang đi. */
const CLOSED_ORDER_STATUSES: ReadonlySet<string> = new Set(['RETURNED', 'CANCELLED']);

export function pancakeShowsDelivered(data: Record<string, unknown>): boolean {
  const raw = data['status'] ?? data['status_name'];
  if (typeof raw !== 'string' && typeof raw !== 'number') return false;
  return DELIVERED_STATUSES.has(String(raw).trim().toLowerCase());
}

/**
 * Đơn khách đã đổi từ chuyển khoản sang COD, hàng đã rời kho: phần nào của "đã trả" Pancake báo là tiền khách chuyển khoản (có thể trả hai lần), phần
 * nào là tiền thu hộ COD của hãng. `amount` = số chuyển khoản đọc được; 0 = chỉ có cờ "đã thanh toán", không kèm số. null = không có gì phải báo.
 *  - Hàng đang trên đường (chưa giao tới khách): hãng chưa thu COD, nên mọi dấu "đã trả" (cả cờ trơn) là chuyển khoản.
 *  - Hãng đã giao (đơn Tubu DELIVERED, hay chính webhook mang trạng thái 3/15/16): cờ "đã trả" và ô `prepaid` tới bằng tổng đơn có thể là tiền thu hộ COD
 *    Pancake ghi lại, không báo. Còn ô `bank_payment` và phần `prepaid` vượt tổng đơn vẫn là chuyển khoản.
 *  - Đơn Tubu đã hoàn/huỷ: chỉ báo khi có số tiền; cờ trơn không đủ để nói khách chuyển khoản.
 */
export function codSwitchedTransferAfterHandover(
  data: Record<string, unknown>,
  orderTotal: number,
  orderStatus: string,
): { amount: number } | null {
  const prepaid = Math.max(0, Math.round(num(data['prepaid'])));
  const bank = Math.max(0, Math.round(num(data['bank_payment'])));
  if (orderStatus === 'DELIVERED' || pancakeShowsDelivered(data)) {
    const transfer = bank + Math.max(0, prepaid - Math.max(0, orderTotal));
    return transfer > 0 ? { amount: transfer } : null;
  }
  if (prepaid + bank > 0) return { amount: prepaid + bank };
  return hasPancakePaidFlag(data) && !CLOSED_ORDER_STATUSES.has(orderStatus) ? { amount: 0 } : null;
}
