import { IsIn, IsString, Matches } from 'class-validator';

export class GrantRoleDto {
  @IsString()
  @Matches(/^0\d{8,10}$/, { message: 'Số điện thoại không hợp lệ.' })
  phone!: string;

  @IsIn(['STAFF', 'ADMIN'])
  role!: 'STAFF' | 'ADMIN';
}
