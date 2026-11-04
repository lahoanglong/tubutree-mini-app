import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RevokeRoleDto {
  @IsString()
  @Matches(/^0\d{8,10}$/, { message: 'Số điện thoại không hợp lệ.' })
  phone!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3, { message: 'Cần ghi lý do (ít nhất 3 ký tự).' })
  @MaxLength(500)
  reason!: string;
}
