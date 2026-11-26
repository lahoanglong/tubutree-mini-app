import { Type } from 'class-transformer';
import { IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { NO_HTML } from '../../users/dto/address.dto';

// Cùng luật với CreateAddressDto (users/dto/address.dto.ts): địa chỉ đi thẳng sang Pancake và shipper.
const VN_PHONE = /^(0|\+84)\d{9}$/;
const NEW_GEO = /^84_VN[0-9A-Za-z_]+$/;
const PHONE_MSG = { message: 'Số điện thoại không hợp lệ (10 số, bắt đầu bằng 0 hoặc +84).' };
const NO_HTML_MSG = { message: 'Tên người nhận và địa chỉ không được chứa ký tự < hoặc >.' };
const GEO_MSG = { message: 'Tỉnh/thành chưa theo địa giới mới, bạn chọn lại nhé.' };
const REQUIRED_MSG = { message: 'Bạn điền đủ người nhận, số điện thoại, phường/xã và số nhà nhé.' };

/** Địa chỉ mới của đơn. Không nhận tên tỉnh: máy chủ giữ tỉnh của đơn và ép `provinceCode` trùng tỉnh đó (order-customer-edit.ts). */
export class OrderEditAddressDto {
  // Khác CreateAddressDto: ba ô chữ không được rỗng (sau khi cắt) vì đi thẳng vào nhãn Pancake của đơn đang chờ giao.
  @Trim() @IsString() @IsNotEmpty(REQUIRED_MSG) @MaxLength(120) @Matches(NO_HTML, NO_HTML_MSG) recipient!: string;
  @Trim() @IsString() @MaxLength(20) @Matches(VN_PHONE, PHONE_MSG) phone!: string;
  @Trim() @IsString() @IsNotEmpty(REQUIRED_MSG) @MaxLength(120) @Matches(NO_HTML, NO_HTML_MSG) ward!: string;
  @Trim() @IsString() @IsNotEmpty(REQUIRED_MSG) @MaxLength(255) @Matches(NO_HTML, NO_HTML_MSG) street!: string;
  @IsString() @MaxLength(20) @Matches(NEW_GEO, GEO_MSG) provinceCode!: string;
  @IsString() @MaxLength(20) districtCode!: string;
  @IsString() @MaxLength(20) wardCode!: string;
}

/** PATCH /orders/:code/delivery. Thiếu cả hai trường: 400 (service). `note` '' hoặc null = xoá ghi chú; cùng trần 500 với checkout. */
export class EditOrderDeliveryDto {
  @OptionalNotNull() @IsObject() @ValidateNested() @Type(() => OrderEditAddressDto) address?: OrderEditAddressDto;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Trim() @IsString() @MaxLength(500) note?: string | null;
}
