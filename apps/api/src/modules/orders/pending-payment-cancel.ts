/**
 * Cách huỷ một đơn trả trước quá hạn thanh toán, dùng chung cho cron tự huỷ (PendingPaymentExpiryCron) và webhook MSS báo quá hạn
 * chuyển khoản (MssPaymentRescueService): cùng một lần lật có điều kiện trong OrderStatusService.setStatus, nên hai đường chạy chồng
 * nhau thì chỉ một bên thắng, hoàn kho/flash/mã giảm giá/điểm đúng một lần và khách nhận đúng một tin.
 */
export function pendingPaymentCancelOpts(note: string) {
  return {
    actorType: 'SYSTEM' as const,
    note,
    // Tiền về chen giữa lúc đọc và lúc lật thì lần huỷ trượt, đơn giữ nguyên PAID.
    onlyIfUnpaid: true,
    expectedStatus: 'PENDING_PAYMENT' as const,
    // D1: đơn chuyển khoản chờ tiền đã lên Pancake (kèm "CHỜ CHUYỂN KHOẢN") thì huỷ cả bên Pancake.
    pancakeGate: true,
    // Khách cần biết VÌ SAO đơn huỷ và nếu lỡ chuyển khoản muộn thì tiền đi đâu (BUYERMINI-8).
    notifyEvent: 'ORDER_PAYMENT_EXPIRED',
  };
}
