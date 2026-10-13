import { registerDecorator } from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * Host nhận ảnh upload: ImageUpload của miniapp đẩy thẳng lên Cloudinary (unsigned preset) và lưu
 * `secure_url` — luôn https://res.cloudinary.com/...
 */
export const UPLOAD_IMAGE_HOSTS: readonly string[] = ['res.cloudinary.com'];

/**
 * ImageUpload fallback sang ảnh nén base64 (JPEG ~150-250KB → ~330 nghìn ký tự) khi chưa cấu hình Cloudinary
 * — trường hợp hiện tại ở PROD — nên vẫn phải nhận data URL, nhưng CHỈ ảnh raster: SVG/HTML chạy được script.
 * Trần cùng IMAGE_MAX của brand.dto/storefront; 6 ảnh vẫn dưới trần body 10mb ở main.ts.
 */
export const DEFAULT_MAX_DATA_URL_LENGTH = 1_500_000;

/**
 * Trần ảnh base64 cho nội dung người dùng đăng công khai (đánh giá, bài cộng đồng): các danh sách này trả ảnh
 * nguyên văn cho mọi người xem nên chặt hơn ảnh minh chứng đổi/trả (chỉ admin xem). Ảnh nén 1200px thường
 * ~150-400KB (200-530 nghìn ký tự).
 */
export const PUBLIC_CONTENT_MAX_DATA_URL_LENGTH = 1_000_000;
const MAX_HTTPS_URL_LENGTH = 1_000;
const RASTER_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isUploadedImage(value: unknown, maxDataUrlLength = DEFAULT_MAX_DATA_URL_LENGTH): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.startsWith('data:')) return value.length <= maxDataUrlLength && RASTER_DATA_URL_RE.test(value);
  if (value.length > MAX_HTTPS_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && UPLOAD_IMAGE_HOSTS.includes(url.hostname) && !url.username && !url.password;
}

/** Ảnh người dùng tự tải lên (đánh giá, bài cộng đồng, minh chứng đổi/trả): chỉ host upload tin cậy hoặc ảnh raster base64. */
export function IsUploadedImage(options: { maxDataUrlLength?: number } = {}, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isUploadedImage',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isUploadedImage(value, options.maxDataUrlLength),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} chỉ nhận ảnh đã tải lên (https://${UPLOAD_IMAGE_HOSTS.join(', ')}) hoặc ảnh base64 png/jpeg/webp/gif.`,
      },
    });
  };
}
