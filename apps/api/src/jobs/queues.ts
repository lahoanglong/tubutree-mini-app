/** Tên các queue BullMQ dùng chung. */
export const QUEUE_PANCAKE_EVENTS = 'pancake-events';
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_ZALO_OA_EVENTS = 'zalo-oa-events';
/** Đẩy đơn local → Pancake (outbound, khác QUEUE_PANCAKE_EVENTS là webhook inbound).
 * Trước đây pushOrder() gọi trực tiếp trong checkout.service, lỗi chỉ log rồi mất — đơn
 * vẫn CONFIRMED/đã trừ kho nhưng kho vật lý không bao giờ thấy (P0-2,
 * docs/2026-09-08-review-progress.md). Qua queue để có retry+backoff (5 lần, xem
 * jobs/queue.module.ts) thay vì rơi rụng ở lần gọi đầu. */
export const QUEUE_PANCAKE_PUSH = 'pancake-push';
/** Đơn đổi hàng thu gom tái chế ↔ Gomdon (outbound): job 'push' tạo vận đơn (retry + backoff +
 * fail-safe đẩy Pancake) và job 'cancel' huỷ vận đơn khi đơn bị huỷ — xem gomdon/gomdon-queue.ts. */
export const QUEUE_GOMDON_PUSH = 'gomdon-push';
/** Webhook Gomdon (inbound) — event đã lưu DB (gomdon_webhook_events) xử lý async có retry. */
export const QUEUE_GOMDON_EVENTS = 'gomdon-events';
