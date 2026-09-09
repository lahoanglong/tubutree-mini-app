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
