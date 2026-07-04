import { IsString, Matches } from 'class-validator';

export class RevokeRoleDto {
  @IsString()
  @Matches(/^0\d{8,10}$/, { message: 'Số điện thoại không hợp lệ.' })
  phone!: string;
}
