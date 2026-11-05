import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { STAFF_PERMISSIONS, type StaffPermission } from '../../../common/staff-permissions';
import { Trim } from '../../../common/decorators/trim.decorator';

export class GrantRoleDto {
  @IsString()
  @Matches(/^0\d{8,10}$/, { message: 'Số điện thoại không hợp lệ.' })
  @Trim()
  phone!: string;

  @IsIn(['STAFF', 'ADMIN'])
  role!: 'STAFF' | 'ADMIN';

  /** Nhóm việc của nhân viên (bỏ qua với ADMIN). Không gửi = không đổi nhóm. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(STAFF_PERMISSIONS.length)
  @IsIn(STAFF_PERMISSIONS, { each: true, message: 'Nhóm việc không hợp lệ.' })
  permissions?: StaffPermission[];

  // Tuỳ chọn để Mini App bản đã phát hành (không gửi lý do) vẫn gọi được; web admin luôn bắt nhập. Có gửi thì vẫn kiểm đủ ngắn/dài.
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(3, { message: 'Cần ghi lý do (ít nhất 3 ký tự).' })
  @MaxLength(500)
  reason?: string;
}
