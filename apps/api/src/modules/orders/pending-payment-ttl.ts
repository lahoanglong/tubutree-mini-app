import type { SystemConfigService } from '../system-config/system-config.service';

export const PENDING_PAYMENT_TTL_KEY = 'orders.pending_payment_ttl_hours';
export const DEFAULT_PENDING_PAYMENT_TTL_HOURS = 24;
// Sàn 1 giờ: lỡ tay đặt 0 thì đơn khách vừa đặt (đang mở app ngân hàng chuyển khoản) bị huỷ ngay lượt sau.
export const MIN_TTL_HOURS = 1;
export const MAX_TTL_HOURS = 24 * 30;

/** TTL đơn trả trước chờ thanh toán (giờ), kẹp trong [MIN, MAX] — dùng chung cho cron huỷ, hạn ghi trên QR và tin báo. */
export async function readPendingPaymentTtlHours(systemConfig: Pick<SystemConfigService, 'get'>): Promise<number> {
  const raw = await systemConfig.get<unknown>(PENDING_PAYMENT_TTL_KEY, DEFAULT_PENDING_PAYMENT_TTL_HOURS);
  const n = typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_PENDING_PAYMENT_TTL_HOURS;
  return Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, n));
}
