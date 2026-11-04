import { Type } from 'class-transformer';
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
} from 'class-validator';
import { PUBLIC_CONTENT_MAX_DATA_URL_LENGTH, IsUploadedImage } from '../../../common/uploaded-image';
import type { UploadedImageOptions } from '../../../common/uploaded-image';
import { IsTypedVnPhone } from '../../../common/phone';
import { TAX_CODE_RE } from '../../checkout/dto/checkout.dto';

// ImageUpload của miniapp nén JPEG cạnh 1200px (~150-250KB → ~200-330 nghìn ký tự base64) khi chưa cấu hình
// Cloudinary; trần 700k đủ dư và giữ 3 ảnh + chữ dưới 2,2 triệu ký tự mỗi hồ sơ (admin tải về từng ảnh một).
export const DEALER_IMAGE: UploadedImageOptions = {
  maxDataUrlLength: PUBLIC_CONTENT_MAX_DATA_URL_LENGTH,
  verifySignature: true,
};

export class ApplyDealerDto {
  @IsString() @MaxLength(120) businessName!: string;
  @IsOptional() @IsString() @Matches(TAX_CODE_RE, { message: 'Mã số thuế gồm 10 số (chi nhánh thêm -3 số) hoặc 12 số.' }) taxCode?: string;
  @IsString() @MaxLength(120) ownerName!: string;
  @IsString() @IsTypedVnPhone({ message: 'Số điện thoại không hợp lệ (10 số, bắt đầu bằng 0, +84 hoặc 84).' }) phone!: string;
  @IsString() @MaxLength(500) address!: string;
  @IsUploadedImage(DEALER_IMAGE) cccdFrontUrl!: string;
  @IsUploadedImage(DEALER_IMAGE) cccdBackUrl!: string;
  @IsOptional() @IsUploadedImage(DEALER_IMAGE) storeFrontUrl?: string;
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
