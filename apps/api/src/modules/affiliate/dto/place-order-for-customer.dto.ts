import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Một dòng hàng CTV lên đơn hộ (chọn variation + số lượng). */
export class CtvOrderItemDto {
  @IsString() variationId!: string;
  @IsInt() @Min(1) @Max(999) quantity!: number;
}

/**
 * Thông tin người nhận (khách của CTV). District/districtCode optional vì hệ địa giới
 * 2 cấp (Pancake) không còn quận/huyện — FE gửi chuỗi rỗng.
 */
export class CtvOrderCustomerDto {
  @IsString() recipient!: string;
  @IsString() phone!: string;
  @IsString() province!: string;
  @IsOptional() @IsString() district?: string;
  @IsString() ward!: string;
  @IsString() street!: string;
  @IsString() provinceCode!: string;
  @IsOptional() @IsString() districtCode?: string;
  @IsString() wardCode!: string;
}

/**
 * CTV lên đơn hộ khách (Build Spec affiliate.*). Chỉ COD / chuyển khoản — đơn hộ
 * KHÔNG dùng Ví/Xu của CTV, KHÔNG coupon/điểm (đơn reseller đơn giản).
 */
export class PlaceOrderForCustomerDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CtvOrderItemDto)
  items!: CtvOrderItemDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => CtvOrderCustomerDto)
  customer!: CtvOrderCustomerDto;

  @IsIn(['COD', 'BANK_TRANSFER'])
  paymentMethod!: 'COD' | 'BANK_TRANSFER';

  @IsOptional() @IsString() note?: string;
}
