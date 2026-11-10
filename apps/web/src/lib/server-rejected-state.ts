import { errorStatus } from '@tubutree/app-core/api/error-status';

/**
 * Máy chủ đã nói rõ trạng thái khác với thứ màn hình đang hiện: 400/404/409 (đã có yêu cầu chờ xử lý, đơn đã đổi trạng thái, không còn nữa).
 * Mất mạng, hết thời gian, 401/403 và 5xx thì KHÔNG: các lỗi đó hay đến đúng lúc máy chủ đang bận (triển khai), lần tải lại cũng hỏng và lỗi tải
 * sẽ thay cả màn hình bằng màn lỗi. Nếu máy chủ đã ghi trước khi lỗi 5xx thì lần bấm sau nhận 400 "đã có rồi" và tải lại ở đó.
 */
export function serverRejectedState(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 400 || status === 404 || status === 409;
}
