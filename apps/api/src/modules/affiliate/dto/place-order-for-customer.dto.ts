import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { IsTypedVnPhone } from '../../../common/phone';

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
  // Đơn đi thẳng sang Pancake và shipper: thiếu tên, SĐT gọi được hay địa bàn thì đơn kẹt đẩy Pancake và không giao được.
  @Trim() @IsString() @MinLength(2, { message: 'Tên người nhận cần ít nhất 2 ký tự.' }) @MaxLength(120) recipient!: string;
  @IsString() @MaxLength(20) @IsTypedVnPhone() phone!: string;
  @IsString() @MaxLength(120) province!: string;
  @IsOptional() @IsString() @MaxLength(120) district?: string;
  @IsString() @MaxLength(120) ward!: string;
  @Trim() @IsString() @IsNotEmpty({ message: 'Địa chỉ người nhận (số nhà, đường) không được để trống.' }) @MaxLength(255) street!: string;
  @IsString() @IsNotEmpty({ message: 'Chưa chọn tỉnh/thành của người nhận.' }) @MaxLength(20) provinceCode!: string;
  @IsOptional() @IsString() @MaxLength(20) districtCode?: string;
  @IsString() @IsNotEmpty({ message: 'Chưa chọn phường/xã của người nhận.' }) @MaxLength(20) wardCode!: string;
}

/** Báo giá đơn hộ trước khi tạo: đúng giá sẽ tính khi tạo đơn (giờ vàng, phí giao). */
export class QuoteOrderForCustomerDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CtvOrderItemDto)
  items!: CtvOrderItemDto[];
}

/**
 * CTV lên đơn hộ khách (Build Spec affiliate.*). Chỉ COD / chuyển khoản — đơn hộ
 * KHÔNG dùng Ví/Điểm Xanh của CTV, KHÔNG coupon/điểm (đơn reseller đơn giản).
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

  /**
   * Tổng CTV đã thấy ở báo giá (và đã báo khách). Lúc tạo đơn tổng cao hơn số này (giờ vàng vừa hết, phí giao đổi) thì BE trả
   * TOTAL_CHANGED thay vì ghi đơn đắt hơn; client cũ không gửi thì giữ hành vi cũ.
   */
  @IsOptional() @IsInt() @Min(0) expectedTotal?: number;
}
