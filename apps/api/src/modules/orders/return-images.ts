import { createHash, timingSafeEqual } from 'node:crypto';

/** Trần số ảnh mỗi yêu cầu (ReturnRequestDto.images); chỉ số ngoài trần không bao giờ có ảnh. */
export const MAX_RETURN_IMAGES = 6;

/**
 * Mã phiên bản của một ảnh = md5 của `<id yêu cầu>:<chỉ số>:<nội dung>`. Postgres tính cùng giá trị bằng md5(text) nên
 * danh sách chỉ cần hỏi DB mã này, không kéo cả ảnh về Node. Mã đóng hai vai: khoá cache (ảnh đổi thì URL đổi) và quyền
 * xem, vì endpoint ảnh không có đăng nhập (thẻ img không gửi được token) mà chỉ ai đã có mã, tức đã được danh sách của
 * chính mình trả, mới tải được; gắn id + chỉ số để mã của ảnh này không mở được ảnh khác.
 */
export function returnImageVersion(returnId: string, index: number, image: string): string {
  return createHash('md5').update(`${returnId}:${index}:${image}`).digest('hex');
}

/**
 * Ảnh minh chứng trong danh sách: ảnh base64 (chưa cấu hình Cloudinary) nặng tới ~1,5 triệu ký tự/ảnh nên không nhúng
 * trong JSON mà trả đường dẫn tương đối tới API để tải lười và cache. Ảnh https (Cloudinary) và giá trị cũ khác giữ nguyên.
 */
export function returnImageRef(returnId: string, index: number, image: string): string {
  return image.startsWith('data:') ? `/returns/${returnId}/images/${index}?v=${returnImageVersion(returnId, index, image)}` : image;
}

/** So mã `v` trên URL với mã của ảnh đang lưu (so sánh thời gian không đổi). */
export function matchesReturnImageVersion(given: unknown, returnId: string, index: number, image: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(returnImageVersion(returnId, index, image));
  return a.length === b.length && timingSafeEqual(a, b);
}
