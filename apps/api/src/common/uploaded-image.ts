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
  /** Giải mã phần đầu base64 và đối chiếu chữ ký tệp (PNG/JPEG/WebP/GIF) với loại ảnh khai trong data URL. */
  verifySignature?: boolean;
}

/** Ảnh trong đánh giá và bài cộng đồng (hiện công khai). */
export const PUBLIC_CONTENT_IMAGE: UploadedImageOptions = { maxDataUrlLength: PUBLIC_CONTENT_MAX_DATA_URL_LENGTH, allowGif: false };

/** Ảnh trong bài cộng đồng: như PUBLIC_CONTENT_IMAGE, thêm kiểm chữ ký tệp để chuỗi base64 rác không lấp DB. */
export const FEED_POST_IMAGE: UploadedImageOptions = { ...PUBLIC_CONTENT_IMAGE, verifySignature: true };

/** Ảnh nhân viên/quản trị tải lên (QR lương, chứng từ, minh chứng huỷ ca): chỉ người có quyền xem, nên theo trần mặc định, thêm kiểm chữ ký tệp. */
export const STAFF_IMAGE: UploadedImageOptions = { verifySignature: true };

const DATA_URL_HEAD_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/;

/** Chữ ký tệp trong 12 byte đầu (16 ký tự base64) khớp loại ảnh khai ở data URL. */
export function hasImageSignature(dataUrl: string): boolean {
  const head = DATA_URL_HEAD_RE.exec(dataUrl);
  if (!head) return false;
  const bytes = Buffer.from(dataUrl.slice(head[0].length, head[0].length + 16), 'base64');
  switch (head[1]) {
    case 'png':
      return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'jpg':
    case 'jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'webp':
      return bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
    default:
      return bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === 'GIF8';
  }
}

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
    return value.length <= max && re.test(value) && (!options.verifySignature || hasImageSignature(value));
  }
  return isUploadedMediaUrl(value);
}

/** Ảnh đại diện Zalo trả về (s120-ava-talk.zadn.vn, ...): chỉ nhận https và đúng miền của Zalo. */
const ZALO_AVATAR_HOST_RE = /(^|\.)(zadn\.vn|zdn\.vn|zalo\.me)$/i;

/** Ảnh đại diện hồ sơ: https, không user:pass, host upload tin cậy (Cloudinary) hoặc CDN ảnh đại diện Zalo. */
export function isAvatarUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_HTTPS_URL_LENGTH) return false;
  if (isUploadedMediaUrl(value)) return true;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.username && !url.password && ZALO_AVATAR_HOST_RE.test(url.hostname);
}

export function IsAvatarUrl(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isAvatarUrl',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isAvatarUrl(value),
        defaultMessage: (args: ValidationArguments) => `${args.property} chỉ nhận ảnh đã tải lên (https://${UPLOAD_IMAGE_HOSTS.join(', ')}) hoặc ảnh đại diện Zalo.`,
      },
    });
  };
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
