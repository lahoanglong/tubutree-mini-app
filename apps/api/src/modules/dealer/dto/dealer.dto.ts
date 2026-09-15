import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ApplyDealerDto {
  @IsString() businessName!: string;
  @IsOptional() @IsString() taxCode?: string;
  @IsString() ownerName!: string;
  @IsString() phone!: string;
  @IsString() address!: string;
  // Ảnh CCCD/mặt tiền cửa hàng chỉ nhận URL (Cloudinary), không phải chuỗi tuỳ ý — chặn phình
  // bảng DealerApplication bằng chuỗi rác/rất dài (docs/2026-09-16, audit security phần 2).
  @IsUrl({ require_protocol: true }) @MaxLength(1000) cccdFrontUrl!: string;
  @IsUrl({ require_protocol: true }) @MaxLength(1000) cccdBackUrl!: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(1000) storeFrontUrl?: string;
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
