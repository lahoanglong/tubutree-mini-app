/**
 * Biến của tin ORDER_CONFIRMED. Đơn đã trả trước (chuyển khoản, ZaloPay, Ví) thêm câu báo đã nhận tiền qua `{{payment_note}}`;
 * đơn COD để trống nên câu giữ nguyên chữ cũ. Câu bắt đầu bằng một dấu cách để mẫu `...xác nhận.{{payment_note}} Cảm ơn...`
 * ra đúng một khoảng trắng dù biến rỗng.
 */
export const PAYMENT_RECEIVED_NOTE = ' Tubu Tree đã nhận đủ thanh toán.';

export function orderConfirmedData(order: { code: string; paymentStatus: string }): Record<string, string> {
  const data: Record<string, string> = { order_code: order.code };
  if (order.paymentStatus === 'PAID') data.payment_note = PAYMENT_RECEIVED_NOTE;
  return data;
}
