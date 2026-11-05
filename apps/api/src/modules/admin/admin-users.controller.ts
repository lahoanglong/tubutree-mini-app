import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserBlockService } from './user-block.service';
import { AdminService } from './admin.service';
import { AllowStaff } from '../../common/staff-permissions';
import { StaffLookupThrottle } from '../../common/throttle/throttle.config';
import { ForfeitCommissionsDto } from './dto/forfeit-commissions.dto';
import { Trim } from '../../common/decorators/trim.decorator';


export class BlockUserDto {
  @Trim() @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class RevokeSessionsDto {
  @Trim() @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class UnblockUserDto {
  @Trim() @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class StaffPermissionsDto {
  /** Nhóm việc của nhân viên — xem common/staff-permissions.ts. Mảng rỗng = chỉ quầy thu ngân/đổi vỏ/chấm công. */
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) permissions!: string[];
  @Trim() @IsString() @MinLength(3) @MaxLength(500) reason!: string;
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
  // Chi tiết một khách theo id: không trần thì CSKH lật từng id lấy SĐT và số dư, lách qua giới hạn của danh sách. ADMIN không bị.
  @StaffLookupThrottle(30)
  @AllowStaff('CSKH')
  @Get(':id/detail')
  detail(@CurrentUser('sub') viewerId: string, @Param('id') id: string, @CurrentUser('role') role?: string) {
    return this.admin.getUserDetail(id, viewerId, { withExports: role === 'ADMIN' });
  }

  @Put(':id/staff-permissions')
  setStaffPermissions(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: StaffPermissionsDto) {
    return this.admin.setStaffPermissions(adminId, id, dto.permissions, dto.reason);
  }

  @Post(':id/forfeit-commissions')
  @HttpCode(HttpStatus.OK)
  forfeitCommissions(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ForfeitCommissionsDto) {
    return this.admin.forfeitRevokedCommissions(adminId, id, dto.reason);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  block(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: BlockUserDto) {
    return this.blocks.block(adminId, id, dto.reason);
  }

  @Post(':id/revoke-sessions')
  @HttpCode(HttpStatus.OK)
  revokeSessions(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: RevokeSessionsDto) {
    return this.blocks.revokeSessions(adminId, id, dto.reason);
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  unblock(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: UnblockUserDto) {
    return this.blocks.unblock(adminId, id, dto.reason);
  }
}
