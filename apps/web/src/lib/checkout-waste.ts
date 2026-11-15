import { ApiError, NetworkError } from './client-api';

/**
 * Lỗi mà máy chủ có thể đã làm xong việc trước khi trả lời: mất kết nối, quá thời gian, 5xx. Đặt đơn gặp lỗi này phải gửi
 * lại đúng Idempotency-Key cũ và không được tải lại dữ liệu làm thay đổi nội dung đơn; 4xx là máy chủ đã từ chối.
 */
export function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);
}
