import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// Trần độ dài cho MỌI trường text: body limit là 10MB còn cột Postgres là text không giới hạn.
// Thiếu trần thì một tài khoản đã đăng nhập lưu được địa chỉ dài vài MB, và snapshot địa chỉ đó
// đi theo đơn hàng vĩnh viễn rồi hiện lại ở mọi danh sách đơn của quản trị.

export class CreateAddressDto {
  @IsString() @MaxLength(120) recipient!: string;
  @IsString() @MaxLength(20) phone!: string;
  @IsString() @MaxLength(120) province!: string;
  @IsString() @MaxLength(120) district!: string;
  @IsString() @MaxLength(120) ward!: string;
  @IsString() @MaxLength(255) street!: string;
  @IsString() @MaxLength(20) provinceCode!: string;
  @IsString() @MaxLength(20) districtCode!: string;
  @IsString() @MaxLength(20) wardCode!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional() @IsString() @MaxLength(120) recipient?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) province?: string;
  @IsOptional() @IsString() @MaxLength(120) district?: string;
  @IsOptional() @IsString() @MaxLength(120) ward?: string;
  @IsOptional() @IsString() @MaxLength(255) street?: string;
  @IsOptional() @IsString() @MaxLength(20) provinceCode?: string;
  @IsOptional() @IsString() @MaxLength(20) districtCode?: string;
  @IsOptional() @IsString() @MaxLength(20) wardCode?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
