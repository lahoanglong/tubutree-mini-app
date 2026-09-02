import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  /**
   * Ngày sinh — dùng cho voucher sinh nhật. Bắt buộc đúng dạng date-only "YYYY-MM-DD"
   * (không dùng @IsDateString vì nó chấp nhận cả datetime kèm offset; service ép
   * thẳng qua `new Date(dob)` nên offset lệch múi giờ có thể đổi ngày lưu xuống DB).
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dob phải theo định dạng YYYY-MM-DD.' })
  dob?: string;
}
