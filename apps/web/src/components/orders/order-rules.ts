/** Số MÓN của đơn (tổng số lượng), không phải số dòng. */
export function orderUnitCount(items: readonly { quantity: number }[]): number {
  return items.reduce((s, it) => s + it.quantity, 0);
}

/**
 * Đơn chuyển khoản còn chờ tiền, Tubu chưa nhận xử lý tay và chưa quá hạn: dùng cho nút "Thanh toán ngay" ở thẻ đơn. Quá hạn thì
 * cron sắp huỷ đơn nên không mời trả nữa; không có hạn (hoặc hạn không đọc được) thì giữ như cũ.
 */
export function canPayNow(
  o: { status: string; paymentMethod: string; manualHandling?: boolean | null; paymentDeadline?: string | null },
  now: number = Date.now(),
): boolean {
  if (o.status !== 'PENDING_PAYMENT' || o.paymentMethod !== 'BANK_TRANSFER' || o.manualHandling) return false;
  const deadline = o.paymentDeadline ? Date.parse(o.paymentDeadline) : Number.NaN;
  return Number.isNaN(deadline) || deadline > now;
}

/** Chỉ in "Hạn" khi còn chờ tiền và API có trả hạn. */
export const showsPaymentDeadline = (o: { status: string; paymentStatus?: string | null; paymentDeadline?: string | null }): boolean =>
  o.status === 'PENDING_PAYMENT' && o.paymentStatus === 'UNPAID' && !!o.paymentDeadline;
