import { RETURN_IMAGE_HOSTS } from '../orders/dto/return-request.dto';

const MAX_URL_LENGTH = 1_000;

/**
 * Ảnh/video đánh giá chỉ nhận file đã tải lên Cloudinary qua ứng dụng (https). Đánh giá hiện công khai trên trang sản
 * phẩm và có thưởng Điểm Xanh theo media: chuỗi bất kỳ hay URL host lạ vừa là nội dung lạ vừa là điểm thưởng không công
 * (MONEY-10). Ảnh base64 chưa bao giờ lọt được (trần 500 ký tự) nên không nhận ở đây.
 */
export function isUploadedReviewMedia(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && RETURN_IMAGE_HOSTS.includes(url.hostname) && !url.username && !url.password;
}
