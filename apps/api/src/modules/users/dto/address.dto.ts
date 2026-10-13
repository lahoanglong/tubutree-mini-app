import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// Trần độ dài cho MỌI trường text: body limit là 10MB còn cột Postgres là text không giới hạn.
// Thiếu trần thì một tài khoản đã đăng nhập lưu được địa chỉ dài vài MB, và snapshot địa chỉ đó
// đi theo đơn hàng vĩnh viễn rồi hiện lại ở mọi danh sách đơn của quản trị.

// Cùng quy tắc với form địa chỉ của miniapp/web (VN_PHONE) — địa chỉ đi thẳng sang Pancake và shipper.
const VN_PHONE = /^(0|\+84)\d{9}$/;
const NO_HTML = /^[^<>]*$/;
const NEW_GEO = /^84_VN[0-9A-Za-z_]+$/;
const PHONE_MSG = { message: 'Số điện thoại không hợp lệ (10 số, bắt đầu bằng 0 hoặc +84).' };
const NO_HTML_MSG = { message: 'Tên người nhận và địa chỉ không được chứa ký tự < hoặc >.' };
const GEO_MSG = { message: 'Tỉnh/thành chưa theo địa giới mới, vui lòng chọn lại.' };

export class CreateAddressDto {
  @IsString() @MaxLength(120) @Matches(NO_HTML, NO_HTML_MSG) recipient!: string;
  @IsString() @MaxLength(20) @Matches(VN_PHONE, PHONE_MSG) phone!: string;
  @IsString() @MaxLength(120) province!: string;
  @IsString() @MaxLength(120) district!: string;
  @IsString() @MaxLength(120) ward!: string;
  @IsString() @MaxLength(255) @Matches(NO_HTML, NO_HTML_MSG) street!: string;
  @IsString() @MaxLength(20) @Matches(NEW_GEO, GEO_MSG) provinceCode!: string;
  @IsString() @MaxLength(20) districtCode!: string;
  @IsString() @MaxLength(20) wardCode!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional() @IsString() @MaxLength(120) @Matches(NO_HTML, NO_HTML_MSG) recipient?: string;
  @IsOptional() @IsString() @MaxLength(20) @Matches(VN_PHONE, PHONE_MSG) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) province?: string;
  @IsOptional() @IsString() @MaxLength(120) district?: string;
  @IsOptional() @IsString() @MaxLength(120) ward?: string;
  @IsOptional() @IsString() @MaxLength(255) @Matches(NO_HTML, NO_HTML_MSG) street?: string;
  @IsOptional() @IsString() @MaxLength(20) @Matches(NEW_GEO, GEO_MSG) provinceCode?: string;
  @IsOptional() @IsString() @MaxLength(20) districtCode?: string;
  @IsOptional() @IsString() @MaxLength(20) wardCode?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
