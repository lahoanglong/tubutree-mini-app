import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  registerDecorator,
} from 'class-validator';
import { DEFAULT_MAX_DATA_URL_LENGTH, IsUploadedImage } from '../../../common/uploaded-image';
import type { UploadedImageOptions } from '../../../common/uploaded-image';
import { TAX_CODE_RE } from '../../checkout/dto/checkout.dto';

// Trần bằng trần mà API nhận cho ảnh base64 nói chung (và ≥ trần nén của web, MAX_UPLOAD_DATA_URL_LENGTH): ảnh giấy tờ nhiều chi tiết
// có thể ra ~800 nghìn ký tự. 3 ảnh + chữ vẫn dưới trần thân 10mb của /api/dealer (body-limits.ts).
export const DEALER_IMAGE: UploadedImageOptions = {
  maxDataUrlLength: DEFAULT_MAX_DATA_URL_LENGTH,
  verifySignature: true,
};
const DEALER_IMAGE_MSG = { message: 'Ảnh quá nặng hoặc không hợp lệ. Hãy chụp lại hoặc chọn ảnh nhỏ hơn.' };

// Ô tuỳ chọn mà khách gõ rồi xoá thì client gửi chuỗi rỗng: coi như không gửi.
const blankToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? undefined : t;
};

/** Số liên hệ của doanh nghiệp sau chuẩn hoá: di động 0[35789] + 8 số (cùng đầu số với PHONE_LIKE) hoặc số bàn 02 + 9 số. */
const VN_BUSINESS_PHONE = /^(?:0[35789]\d{8}|02\d{9})$/;
const PHONE_MSG = 'Số điện thoại không hợp lệ (di động hoặc số bàn, bắt đầu bằng 0, +84 hoặc 84).';

/** Bỏ ký tự không phải số, đổi tiền tố 84 thành 0 (đi thẳng sang Pancake nên lưu một dạng 0xxxxxxxxx). Chuỗi không phải số VN giữ nguyên để validator báo lỗi. */
export function normalizeBusinessPhone(raw: string): string {
  const local = raw.replace(/\D/g, '').replace(/^84/, '0');
  return VN_BUSINESS_PHONE.test(local) ? local : raw;
}
function IsVnBusinessPhone() {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isVnBusinessPhone',
      target: object.constructor,
      propertyName,
      options: { message: PHONE_MSG },
      validator: { validate: (v: unknown) => typeof v === 'string' && VN_BUSINESS_PHONE.test(v) },
    });
  };
}

export class ApplyDealerDto {
  @IsString() @MaxLength(120) businessName!: string;
  @IsOptional() @Transform(blankToUndefined) @IsString() @Matches(TAX_CODE_RE, { message: 'Mã số thuế gồm 10 số (chi nhánh thêm -3 số) hoặc 12 số.' }) taxCode?: string;
  @IsString() @MaxLength(120) ownerName!: string;
  @Transform(({ value }) => (typeof value === 'string' ? normalizeBusinessPhone(value) : value)) @IsString() @MaxLength(30) @IsVnBusinessPhone() phone!: string;
  @IsString() @MaxLength(500) address!: string;
  @IsUploadedImage(DEALER_IMAGE, DEALER_IMAGE_MSG) cccdFrontUrl!: string;
  @IsUploadedImage(DEALER_IMAGE, DEALER_IMAGE_MSG) cccdBackUrl!: string;
  @IsOptional() @Transform(blankToUndefined) @IsUploadedImage(DEALER_IMAGE, DEALER_IMAGE_MSG) storeFrontUrl?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) monthlyVolumeEstimate?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
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
  /** Địa chỉ nhận trong sổ địa chỉ của đại lý. Bỏ trống → địa chỉ mặc định, rồi tới địa chỉ trong hồ sơ đại lý. */
  @IsOptional() @IsString() addressId?: string;
}
