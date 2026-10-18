/**
 * Mã voucher cá nhân tất định theo (lý do, userId đầy đủ): coupon.code @unique là chốt idempotency của VouchersService.grant
 * (chống 2 instance cron hay đăng ký song song cấp trùng). Nơi khác cần tìm đúng mã đã cấp cho một khách phải dựng bằng hàm này.
 */
export function voucherCode(reason: string, userId: string): string {
  return `${reason}-${userId}`.toUpperCase();
}
