import { errorStatus } from '@tubutree/app-core/api/error-status';

/**
 * Máy chủ đã nói rõ trạng thái khác với thứ màn hình đang hiện: 400/404/409/422 (đã có yêu cầu chờ xử lý, đơn đã đổi trạng thái, không còn nữa).
 * Mất mạng, hết thời gian, 401/403 và 5xx thì KHÔNG: các lỗi đó hay đến đúng lúc máy chủ đang bận (triển khai), lần tải lại cũng hỏng và lỗi tải
 * sẽ thay cả màn hình bằng màn lỗi. Nếu máy chủ đã ghi trước khi lỗi 5xx thì lần bấm sau nhận 400 "đã có rồi" và tải lại ở đó.
 *
 * `userInput`: lệnh có ô người dùng tự nhập (ghi chú, số tài khoản, số lượng gõ tay). Với lệnh đó 400 thường là máy chủ chê dữ liệu nhập (DTO), lỗi
 * hiện dưới form và KHÔNG tải lại: dữ liệu trên màn vẫn đúng, tải lại chỉ làm khách tưởng danh sách đã mới trong khi chữ họ nhập mới là cái sai. Chỉ 404/409/422 là dữ liệu cũ.
 */
export function serverRejectedState(error: unknown, options: { userInput?: boolean } = {}): boolean {
  const status = errorStatus(error);
  if (status === 404 || status === 409 || status === 422) return true;
  return status === 400 && !options.userInput;
}
