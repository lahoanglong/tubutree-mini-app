import type { SystemConfigService } from '../system-config/system-config.service';
import { PREPAID_METHODS } from './order-transition';

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

export interface PaymentDeadlineFacts {
  type: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  createdAt: Date | string;
  autoCancelBlockedAt?: Date | string | null;
}

/**
 * Hạn thanh toán ghi cho khách (chi tiết đơn, trang QR) — đúng mốc và đúng điều kiện cron tự huỷ (PendingPaymentExpiryCron):
 * đơn lẻ/đại lý trả trước đang chờ tiền, TTL riêng cho đơn đại lý. Null khi cron không huỷ đơn này, kể cả khi hệ thống đã thôi
 * tự huỷ vì hàng đã bàn giao vận chuyển (autoCancelBlockedAt) — không hứa "quá hạn đơn sẽ tự huỷ" cho đơn sẽ không bị huỷ.
 */
export async function pendingPaymentDeadline(
  order: PaymentDeadlineFacts,
  systemConfig: Pick<SystemConfigService, 'get'>,
): Promise<string | null> {
  if (order.status !== 'PENDING_PAYMENT' || order.paymentStatus !== 'UNPAID') return null;
  if (order.type !== 'RETAIL' && order.type !== 'DEALER') return null;
  if (!(PREPAID_METHODS as readonly string[]).includes(order.paymentMethod)) return null;
  if (order.autoCancelBlockedAt) return null;
  const hours =
    order.type === 'DEALER' ? await readDealerPendingPaymentTtlHours(systemConfig) : await readPendingPaymentTtlHours(systemConfig);
  return new Date(new Date(order.createdAt).getTime() + hours * 3_600_000).toISOString();
}

/**
 * Hạn thanh toán cho cả một trang đơn (danh sách): đọc mỗi khoá TTL tối đa một lần dù có nhiều đơn chờ tiền, và không đọc
 * gì nếu trang không có đơn nào cần hạn. Khoá theo `id` đơn.
 */
export async function pendingPaymentDeadlines(
  orders: readonly (PaymentDeadlineFacts & { id: string })[],
  systemConfig: Pick<SystemConfigService, 'get'>,
): Promise<Map<string, string | null>> {
  const reads = new Map<string, Promise<unknown>>();
  const readOnce: Pick<SystemConfigService, 'get'> = {
    get: <T>(key: string, fallback?: T) => {
      let read = reads.get(key);
      if (!read) {
        read = systemConfig.get<T>(key, fallback);
        reads.set(key, read);
      }
      return read as Promise<T>;
    },
  };
  const entries = await Promise.all(orders.map(async (o) => [o.id, await pendingPaymentDeadline(o, readOnce)] as const));
  return new Map(entries);
}
