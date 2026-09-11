import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
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
  // Trần độ dài cho mọi trường text: body limit là 10MB, cột Postgres là text không giới hạn.
  // Không có trần thì một tài khoản đã đăng nhập gửi được tên người nhận dài vài MB, lưu vĩnh
  // viễn trong snapshot địa chỉ của đơn rồi hiện lại ở mọi danh sách đơn của quản trị.
  @IsString() @MaxLength(120) recipient!: string;
  @IsString() @MaxLength(20) phone!: string;
  @IsString() @MaxLength(120) province!: string;
  @IsOptional() @IsString() @MaxLength(120) district?: string;
  @IsString() @MaxLength(120) ward!: string;
  @IsString() @MaxLength(255) street!: string;
  @IsString() @MaxLength(20) provinceCode!: string;
  @IsOptional() @IsString() @MaxLength(20) districtCode?: string;
  @IsString() @MaxLength(20) wardCode!: string;
}

/**
 * CTV lên đơn hộ khách (Build Spec affiliate.*). Chỉ COD / chuyển khoản — đơn hộ
 * KHÔNG dùng Ví/Xu của CTV, KHÔNG coupon/điểm (đơn reseller đơn giản).
 */
export class PlaceOrderForCustomerDto {
  @IsArray()
  @ArrayMinSize(1)
  // Chặn body khổng lồ: mỗi dòng là 1 vòng truy vấn giá + trừ kho, không giới hạn thì 1 request
  // có thể ghim DB (P2, docs/2026-09-08-review-progress.md). Đơn thật không quá vài chục dòng.
  @ArrayMaxSize(50)
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
