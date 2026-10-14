import type { SystemConfigService } from '../system-config/system-config.service';

export const PENDING_PAYMENT_TTL_KEY = 'orders.pending_payment_ttl_hours';
export const DEFAULT_PENDING_PAYMENT_TTL_HOURS = 24;
/** Đơn đại lý "Trả trước" (chuyển khoản theo hợp đồng) được chờ lâu hơn khách lẻ: đơn sỉ, kế toán đại lý duyệt chi. */
export const DEALER_PENDING_PAYMENT_TTL_KEY = 'orders.dealer_pending_payment_ttl_hours';
export const DEFAULT_DEALER_PENDING_PAYMENT_TTL_HOURS = 72;
// Sàn 1 giờ: lỡ tay đặt 0 thì đơn khách vừa đặt (đang mở app ngân hàng chuyển khoản) bị huỷ ngay lượt sau.
export const MIN_TTL_HOURS = 1;
export const MAX_TTL_HOURS = 24 * 30;

/** TTL đơn trả trước chờ thanh toán (giờ), kẹp trong [MIN, MAX] — dùng chung cho cron huỷ, hạn ghi trên QR và tin báo. */
export async function readPendingPaymentTtlHours(
  systemConfig: Pick<SystemConfigService, 'get'>,
  key: string = PENDING_PAYMENT_TTL_KEY,
  fallback: number = DEFAULT_PENDING_PAYMENT_TTL_HOURS,
): Promise<number> {
  const raw = await systemConfig.get<unknown>(key, fallback);
  const n = typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, n));
}

/** TTL đơn đại lý "Trả trước" (SELLER-7). */
export function readDealerPendingPaymentTtlHours(systemConfig: Pick<SystemConfigService, 'get'>): Promise<number> {
  return readPendingPaymentTtlHours(systemConfig, DEALER_PENDING_PAYMENT_TTL_KEY, DEFAULT_DEALER_PENDING_PAYMENT_TTL_HOURS);
}
