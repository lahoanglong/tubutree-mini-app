import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RevokeRoleDto {
  @IsString()
  @Matches(/^0\d{8,10}$/, { message: 'Số điện thoại không hợp lệ.' })
  phone!: string;

  // Tuỳ chọn để Mini App bản đã phát hành (không gửi lý do) vẫn gọi được; web admin luôn bắt nhập. Có gửi thì vẫn kiểm đủ ngắn/dài.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3, { message: 'Cần ghi lý do (ít nhất 3 ký tự).' })
  @MaxLength(500)
  reason?: string;
}
