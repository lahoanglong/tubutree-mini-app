import { registerDecorator } from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * Host nhận ảnh/video upload: ImageUpload/VideoUpload của miniapp đẩy thẳng lên Cloudinary (unsigned preset) và lưu
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
 * Trần ảnh base64 cho nội dung người dùng đăng công khai (đánh giá, bài cộng đồng): các danh sách này trả ảnh nguyên
 * văn cho mọi người xem nên chặt hơn ảnh minh chứng đổi/trả (chỉ admin xem). MultiImageUpload nén JPEG cạnh 1200px,
 * thường ~150-400KB (200-530 nghìn ký tự).
 */
export const PUBLIC_CONTENT_MAX_DATA_URL_LENGTH = 700_000;
const MAX_HTTPS_URL_LENGTH = 1_000;
const RASTER_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
// Miniapp chỉ sinh JPEG (canvas.toDataURL); nội dung công khai không nhận GIF động nặng.
const STILL_RASTER_DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export interface UploadedImageOptions {
  maxDataUrlLength?: number;
  allowGif?: boolean;
}

/** Ảnh trong đánh giá và bài cộng đồng (hiện công khai). */
export const PUBLIC_CONTENT_IMAGE: UploadedImageOptions = { maxDataUrlLength: PUBLIC_CONTENT_MAX_DATA_URL_LENGTH, allowGif: false };

/** URL https trên host upload tin cậy (không user:pass). Dùng cho video đánh giá, vốn không có đường base64. */
export function isUploadedMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_HTTPS_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && UPLOAD_IMAGE_HOSTS.includes(url.hostname) && !url.username && !url.password;
}

export function isUploadedImage(value: unknown, options: UploadedImageOptions = {}): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.startsWith('data:')) {
    const max = options.maxDataUrlLength ?? DEFAULT_MAX_DATA_URL_LENGTH;
    const re = options.allowGif === false ? STILL_RASTER_DATA_URL_RE : RASTER_DATA_URL_RE;
    return value.length <= max && re.test(value);
  }
  return isUploadedMediaUrl(value);
}

const MAX_STOREFRONT_IMAGE_URL_LENGTH = 2_048;

/**
 * Ảnh đại diện/ảnh bìa gian hàng: chuỗi rỗng (xoá ảnh), ảnh raster base64, hoặc URL https không kèm user:pass. Nhận mọi host https vì
 * cổng /merchant cho dán link ảnh; web chỉ tải ảnh về dựng thẻ chia sẻ khi host nằm trong danh sách cho phép (web/lib/og-image-fetch.ts),
 * nên địa chỉ nội bộ (http://api:3001, 169.254.169.254) bị chặn ngay lúc lưu và lúc tải.
 */
export function isStorefrontImageValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.trim() === '') return true;
  if (value.startsWith('data:')) return isUploadedImage(value);
  if (value.length > MAX_STOREFRONT_IMAGE_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.username && !url.password;
}

/** Ảnh người dùng tự tải lên (đánh giá, bài cộng đồng, minh chứng đổi/trả): chỉ host upload tin cậy hoặc ảnh raster base64. */
export function IsUploadedImage(options: UploadedImageOptions = {}, validationOptions?: ValidationOptions) {
  const types = options.allowGif === false ? 'png/jpeg/webp' : 'png/jpeg/webp/gif';
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isUploadedImage',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isUploadedImage(value, options),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} chỉ nhận ảnh đã tải lên (https://${UPLOAD_IMAGE_HOSTS.join(', ')}) hoặc ảnh base64 ${types}.`,
      },
    });
  };
}

/** Video/tệp đã tải lên host upload tin cậy (https), không nhận data URL hay host lạ. */
export function IsUploadedMediaUrl(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isUploadedMediaUrl',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isUploadedMediaUrl(value),
        defaultMessage: (args: ValidationArguments) => `${args.property} chỉ nhận tệp đã tải lên (https://${UPLOAD_IMAGE_HOSTS.join(', ')}).`,
      },
    });
  };
}

/** Ảnh bìa/logo quản trị đặt: rỗng, link https hoặc ảnh raster base64 (cùng luật gian hàng). Chặn javascript:, http:, SVG. */
export function IsImageRef(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isImageRef',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isStorefrontImageValue(value),
        defaultMessage: (args: ValidationArguments) => `${args.property} chỉ nhận link https hoặc ảnh tải lên (png, jpeg, webp, gif).`,
      },
    });
  };
}
