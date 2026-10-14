import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserBlockService } from './user-block.service';
import { AdminService } from './admin.service';
import { AllowStaff } from '../../common/staff-permissions';

export class BlockUserDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class StaffPermissionsDto {
  /** Nhóm việc của nhân viên — xem common/staff-permissions.ts. Mảng rỗng = chỉ quầy thu ngân/đổi vỏ/chấm công. */
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) permissions!: string[];
}

@ApiTags('admin-users')
@Roles('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly blocks: UserBlockService,
    private readonly admin: AdminService,
  ) {}

  /** Hồ sơ + đơn + sổ ví + Điểm Xanh + lịch sử vai trò/khoá (ADMINOPS-11). CSKH xem được để trả lời khách. */
  @AllowStaff('CSKH')
  @Get(':id/detail')
  detail(@Param('id') id: string) {
    return this.admin.getUserDetail(id);
  }

  @Put(':id/staff-permissions')
  setStaffPermissions(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: StaffPermissionsDto) {
    return this.admin.setStaffPermissions(adminId, id, dto.permissions);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  block(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: BlockUserDto) {
    return this.blocks.block(adminId, id, dto.reason);
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  unblock(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.blocks.unblock(adminId, id);
  }
}
