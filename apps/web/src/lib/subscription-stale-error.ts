import { errorStatus } from '@tubutree/app-core/api/error-status';

/**
 * Máy chủ từ chối lệnh vì gói không còn như thẻ đang hiện: 400 (đã huỷ, đã tạm dừng), 404 (không còn), 409 (lịch vừa đổi, trùng gói).
 * Thẻ cũ bấm lại sẽ nhận đúng lỗi đó mãi nên phải tải lại danh sách. Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: không tính.
 */
export const isStaleSubscriptionError = (error: unknown): boolean => [400, 404, 409].includes(errorStatus(error) ?? 0);
