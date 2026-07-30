import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RbacService } from './rbac/rbac.service';
import { GrantRoleDto } from './dto/grant-role.dto';
import { RevokeRoleDto } from './dto/revoke-role.dto';

@ApiTags('admin-staff')
@Roles('ADMIN')
@Controller('admin/staff')
export class AdminStaffController {
  constructor(private readonly rbac: RbacService) {}

  @Get()
  list() {
    return this.rbac.listStaff();
  }

  @Post('grant')
  grant(@CurrentUser('sub') adminId: string, @Body() dto: GrantRoleDto) {
    return this.rbac.addGrant(adminId, dto.phone, dto.role);
  }

  @Post('revoke')
  revoke(@CurrentUser('sub') adminId: string, @Body() dto: RevokeRoleDto) {
    return this.rbac.revokeGrant(adminId, dto.phone);
  }
}
