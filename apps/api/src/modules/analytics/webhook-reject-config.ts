import { LAUNCH_WATCH_WEBHOOK_SOURCES, type LaunchWatchWebhookSource } from '@tubutree/shared-types';

/**
 * Hằng dùng chung cho bộ đếm webhook bị từ chối 401. Cố ý KHÔNG import service nào: controller Pancake/Gomdon, LaunchWatchService và
 * WebhookRejectCounterService cùng đọc file này, import ngược qua service sẽ thành vòng import làm API không khởi động.
 */
export const WEBHOOK_SOURCES = LAUNCH_WATCH_WEBHOOK_SOURCES;
export type WebhookSource = LaunchWatchWebhookSource;

/** Một khung đếm = 5 phút (UTC); 12 khung liên tiếp = 1 giờ. */
export const WEBHOOK_REJECT_BUCKET_MS = 5 * 60_000;
export const WEBHOOK_REJECT_BUCKETS_PER_HOUR = 12;
export const WEBHOOK_REJECT_BUCKETS_PER_DAY = 288;

/** Dòng đếm cũ hơn số ngày này bị xoá. */
export const WEBHOOK_REJECT_RETENTION_DAYS = 14;

/** SystemConfig: số lần bị từ chối trong 1 giờ từ mức này trở lên thì tab "Theo dõi 72h" báo đỏ. */
export const WEBHOOK_REJECT_ALERT_KEY = 'ops.webhook_reject_alert_per_hour';
export const WEBHOOK_REJECT_ALERT_DEFAULT = 10;
const WEBHOOK_REJECT_ALERT_MIN = 1;
const WEBHOOK_REJECT_ALERT_MAX = 100_000;

/** Chỉ nhận số nguyên 1 đến 100000; sai kiểu, số lẻ hoặc ngoài khoảng thì dùng mặc định (cấu hình hỏng không được tắt cảnh báo). */
export function normalizeWebhookRejectThreshold(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return WEBHOOK_REJECT_ALERT_DEFAULT;
  if (value < WEBHOOK_REJECT_ALERT_MIN || value > WEBHOOK_REJECT_ALERT_MAX) return WEBHOOK_REJECT_ALERT_DEFAULT;
  return value;
}
