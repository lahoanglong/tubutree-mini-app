import { IsDateString, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

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

  /** Ngày sinh (ISO) — dùng cho voucher sinh nhật. */
  @IsOptional()
  @IsDateString()
  dob?: string;
}
