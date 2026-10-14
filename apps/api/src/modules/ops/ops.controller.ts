import { Controller, Get } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { OpsHealthService } from './ops-health.service';
import { OpsInboxService } from './ops-inbox.service';

@Controller('admin/ops')
@Roles('ADMIN')
export class OpsController {
  constructor(
    private readonly health: OpsHealthService,
    private readonly inbox: OpsInboxService,
  ) {}

  /** Trang chủ "Việc cần xử lý": số việc ở từng hàng đợi — nhân viên chỉ thấy việc thuộc nhóm của mình. */
  @AllowStaff('CSKH', 'KHO')
  @Get('inbox')
  getInbox(@CurrentUser() user: JwtPayload) {
    return this.inbox.counts({ role: user.role, staffPermissions: user.staffPermissions });
  }

  /** Vai trò + nhóm việc hiện hành (đọc lại từ DB mỗi request) để web admin chỉ hiện các mục người này dùng được. */
  @Roles('ADMIN', 'STAFF')
  @Get('access')
  access(@CurrentUser() user: JwtPayload) {
    return { role: user.role, staffPermissions: user.role === 'STAFF' ? (user.staffPermissions ?? []) : [] };
  }

  @Get('health')
  getHealth() {
    return this.health.snapshot();
  }
}
