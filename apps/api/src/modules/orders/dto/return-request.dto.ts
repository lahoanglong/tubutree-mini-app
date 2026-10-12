import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength, registerDecorator } from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * Host nhận ảnh upload: ImageUpload của miniapp đẩy thẳng lên Cloudinary (unsigned preset) và lưu
 * `secure_url` — luôn https://res.cloudinary.com/...
 */
export const RETURN_IMAGE_HOSTS: readonly string[] = ['res.cloudinary.com'];

/**
 * ImageUpload fallback sang ảnh nén base64 (JPEG ~150-250KB → ~330 nghìn ký tự) khi chưa cấu hình Cloudinary
 * — trường hợp hiện tại ở PROD — nên vẫn phải nhận data URL, nhưng CHỈ ảnh raster: SVG/HTML chạy được script.
 * Trần cùng IMAGE_MAX của brand.dto/storefront; 6 ảnh vẫn dưới trần body 10mb ở main.ts.
 */
const MAX_DATA_URL_LENGTH = 1_500_000;
const MAX_HTTPS_URL_LENGTH = 1_000;
const RASTER_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isReturnEvidenceImage(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.startsWith('data:')) return value.length <= MAX_DATA_URL_LENGTH && RASTER_DATA_URL_RE.test(value);
  if (value.length > MAX_HTTPS_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && RETURN_IMAGE_HOSTS.includes(url.hostname) && !url.username && !url.password;
}

function IsReturnEvidenceImage(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isReturnEvidenceImage',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isReturnEvidenceImage(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} chỉ nhận ảnh đã tải lên (https://${RETURN_IMAGE_HOSTS.join(', ')}) hoặc ảnh base64 png/jpeg/webp/gif.`,
      },
    });
  };
}

export class ReturnRequestDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
  // C-050: ảnh minh chứng hiện ở admin web — chặn javascript:/data:text/html/host lạ ngay khi lưu.
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsReturnEvidenceImage({ each: true }) images?: string[];
}
