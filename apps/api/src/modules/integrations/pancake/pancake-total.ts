import { resolvePancakeStatus } from './pancake-status.map';

/** Số đồng nguyên không âm từ một ô của payload (số hoặc chuỗi số); ô thiếu hoặc không đọc được → null. */
function amount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * Các cách đọc "tổng khách phải trả" của một đơn Pancake, theo schema "Đơn hàng" của Pancake POS Open API:
 * `total_price_after_sub_discount` (tổng sau giảm đơn) + `shipping_fee`, hoặc `total_price` − `total_discount` + ship.
 * Hợp đồng field chưa đối chiếu được với một payload webhook thật (như prepaid/bank_payment, xem pancake-payment.util),
 * nên cách đọc thứ ba — total_price_after_sub_discount đã gộp sẵn phí ship — chỉ dùng để KHÔNG báo nhầm: một đơn lệch
 * thật mà trùng một trong ba cách đọc là hiếm, còn báo nhầm từng đơn thì nhân viên sẽ quen bỏ qua cả hàng đợi.
 * Số đầu tiên là cách đọc chính (dùng để tính chênh lệch hiện cho người xử lý). Không ô tổng nào đọc được → mảng rỗng.
 */
export function pancakeTotalReadings(data: Record<string, unknown>): number[] {
  const afterSub = amount(data['total_price_after_sub_discount']);
  const price = amount(data['total_price']);
  const discount = amount(data['total_discount']);
  const ship = amount(data['shipping_fee']) ?? 0;
  const readings: number[] = [];
  if (afterSub !== null) readings.push(afterSub + ship);
  if (price !== null && discount !== null && price >= discount) readings.push(price - discount + ship);
  if (afterSub !== null) readings.push(afterSub);
  return [...new Set(readings)];
}

/**
 * Tổng trên Pancake có lệch với `order.total` của Tubu không. null = khớp (theo bất kỳ cách đọc nào) hoặc payload không
 * mang số tổng để so. `diff` = số Pancake trừ số Tubu (dương: Pancake cao hơn).
 */
export function pancakeTotalMismatch(
  data: Record<string, unknown>,
  orderTotal: number,
): { pancakeTotal: number; diff: number } | null {
  const readings = pancakeTotalReadings(data);
  if (readings.length === 0 || readings.includes(orderTotal)) return null;
  const pancakeTotal = readings[0]!;
  return { pancakeTotal, diff: pancakeTotal - orderTotal };
}

/**
 * Sự kiện hoàn/huỷ/xoá đơn của Pancake: tổng trên Pancake đổi theo phiếu hoàn hoặc đơn đã đóng, không phải ai đó sửa đơn
 * đang chạy — việc đó đã có luồng riêng (trả hàng, huỷ), không so tổng ở đây.
 */
export function pancakeStatusSkipsTotalCheck(data: Record<string, unknown>): boolean {
  const action = resolvePancakeStatus(data['status'] ?? data['status_name']);
  if (!action) return false;
  return action.kind !== 'status' || action.status === 'CANCELLED';
}
