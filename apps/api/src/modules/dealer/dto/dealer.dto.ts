import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  isURL,
  Min,
  registerDecorator,
  ValidateNested,
} from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';

// P0 A5-10 (docs/audit-2026-09/05-ctv-dealer-staff.md): DTO trước đây chỉ nhận URL http(s)
// (@IsUrl), nhưng ImageUpload (apps/miniapp/src/components/image-upload.tsx) fallback sang base64
// data-URL bất cứ khi nào VITE_CLOUDINARY_* chưa cấu hình — biến này KHÔNG có trong bất kỳ .env
// nào của repo, nên validator cũ chặn 400 mọi hồ sơ đăng ký đại lý. Ảnh nén qua
// readAndCompressImage() (maxDim mặc định 1200, quality 0.82) ra ~150-250KB JPEG → base64 dài
// ~200-330 nghìn ký tự; giới hạn dưới đây cho dư ~6x so với mức thực tế nhưng vẫn chặn payload
// khổng lồ cố ý (DoS) — 3 trường ảnh x 2 triệu ký tự vẫn nằm rất xa dưới trần body 10mb hiện có
// (apps/api/src/main.ts: json({ limit: '10mb' })), nên KHÔNG cần nới trần đó.
const MAX_DATA_URL_LENGTH = 2_000_000;
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

function IsUrlOrImageDataUrl(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isUrlOrImageDataUrl',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          if (typeof value !== 'string' || value.length === 0) return false;
          if (value.length > MAX_DATA_URL_LENGTH) return false;
          if (value.startsWith('data:')) return IMAGE_DATA_URL_RE.test(value);
          return isURL(value, { require_protocol: true });
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} phải là URL hợp lệ (https://...) hoặc ảnh base64 (data:image/...;base64,...), tối đa ${MAX_DATA_URL_LENGTH.toLocaleString('vi-VN')} ký tự.`;
        },
      },
    });
  };
}

export class ApplyDealerDto {
  @IsString() businessName!: string;
  @IsOptional() @IsString() taxCode?: string;
  @IsString() ownerName!: string;
  @IsString() phone!: string;
  @IsString() address!: string;
  // Ảnh CCCD/mặt tiền cửa hàng: chấp nhận URL (Cloudinary) HOẶC base64 data-URL ảnh (fallback thật
  // của ImageUpload khi thiếu Cloudinary) — vẫn chặn chuỗi rác/quá khổ, xem IsUrlOrImageDataUrl().
  @IsUrlOrImageDataUrl() cccdFrontUrl!: string;
  @IsUrlOrImageDataUrl() cccdBackUrl!: string;
  @IsOptional() @IsUrlOrImageDataUrl() storeFrontUrl?: string;
  @IsOptional() @IsInt() monthlyVolumeEstimate?: number;
  @IsOptional() @IsString() notes?: string;
}

export class DealerOrderLine {
  @IsString() variationId!: string;
  @IsInt() @Min(1) quantity!: number;
}

export class DealerOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  // Xem chú thích cùng loại ở place-order-for-customer.dto.ts — mỗi dòng là 1 vòng truy vấn.
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DealerOrderLine)
  items!: DealerOrderLine[];

  @IsIn(['CREDIT', 'PREPAID']) paymentMethod!: string;
  @IsOptional() @IsString() note?: string;
}
