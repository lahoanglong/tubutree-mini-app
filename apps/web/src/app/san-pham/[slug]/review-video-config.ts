import type { VideoUploadConfig } from '@tubutree/app-core/cloudinary-video';

/**
 * Cấu hình tải video đánh giá của bản build này; null khi chưa cấu hình Cloudinary (máy chủ chỉ nhận video đã tải lên đó nên ô chọn
 * bị ẩn và câu thưởng không mời video). Next chỉ nhúng biến NEXT_PUBLIC_* khi viết nguyên dạng `process.env.NEXT_PUBLIC_X`, nên không gom
 * vào một hàm đọc theo tên. Tách khỏi `review-video-upload.tsx` để form biết có mời video không mà không phải nạp mã tải video.
 */
export function reviewVideoConfig(): VideoUploadConfig | null {
  const cloudName = (process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '').trim();
  const uploadPreset = (process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? '').trim();
  return cloudName && uploadPreset ? { cloudName, uploadPreset } : null;
}
