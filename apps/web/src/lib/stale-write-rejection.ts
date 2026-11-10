import { errorStatus } from '@tubutree/app-core/api/error-status';
import { settleWithin } from './settle-within';

/**
 * Máy chủ từ chối lệnh vì dữ liệu đang hiện đã cũ: 400 (trạng thái đã đổi), 404 (không còn), 409 (trùng/xung đột).
 * Bấm lại trên dữ liệu cũ nhận đúng lỗi đó mãi nên phải tải lại. Mất mạng, 401, 403, 5xx không nói gì về trạng thái thật:
 * không tính, vì lần tải lại hỏng có thể thay danh sách đang hiện bằng màn lỗi.
 *
 * `hasInput` cho lệnh có ô người dùng nhập (DTO kiểm dữ liệu vào): ở đó 400 là lỗi nhập liệu (link sai dạng, lý do trống...), tải lại
 * danh sách không sửa được nó và sẽ kèm lời "danh sách đã làm mới" sai sự thật, nên chỉ 404/409 tính là dữ liệu cũ; 400 phải hiện ngay tại form.
 */
export const isStaleWriteRejection = (error: unknown, hasInput = false): boolean => {
  const status = errorStatus(error);
  return (status === 400 && !hasInput) || status === 404 || status === 409;
};

/**
 * Dùng làm kết quả của `onError`: lệnh bị từ chối vì dữ liệu cũ thì tải lại rồi mới nhả khoá (tối đa `settleWithin`, không bao giờ ném);
 * lỗi khác trả undefined để khoá nhả ngay. Lời lỗi phải được đặt vào state trước khi gọi hàm này (`mutation.isError` chỉ lật sau khi Promise của onError xong).
 */
export function reloadWhenStale(error: unknown, reload: () => PromiseLike<unknown> | unknown, hasInput = false): Promise<void> | undefined {
  return isStaleWriteRejection(error, hasInput) ? settleWithin(reload()) : undefined;
}
