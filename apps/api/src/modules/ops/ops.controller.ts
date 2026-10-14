import { BadRequestException, Controller, Get, Param, Post } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { OpsHealthService } from './ops-health.service';
import { OpsInboxService } from './ops-inbox.service';
import { OpsWebhookEventsService, type WebhookSource } from './ops-webhook-events.service';

function webhookSource(v: string): WebhookSource {
  if (v !== 'pancake' && v !== 'gomdon') throw new BadRequestException('Nguồn webhook chỉ nhận pancake hoặc gomdon.');
  return v;
}

@Controller('admin/ops')
@Roles('ADMIN')
export class OpsController {
  constructor(
    private readonly health: OpsHealthService,
    private readonly inbox: OpsInboxService,
    private readonly webhookEvents: OpsWebhookEventsService,
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

  /** "Chạy lại" một webhook Pancake/Gomdon lỗi hoặc kẹt (màn Sức khoẻ hệ thống). */
  @Post('webhook-events/:source/:id/retry')
  retryWebhookEvent(@CurrentUser('sub') adminId: string, @Param('source') source: string, @Param('id') id: string) {
    return this.webhookEvents.retry(webhookSource(source), id, adminId);
  }

  /** "Đã xử lý" — người vận hành đã sửa tay đơn liên quan; sự kiện rời báo động. */
  @Post('webhook-events/:source/:id/dismiss')
  dismissWebhookEvent(@CurrentUser('sub') adminId: string, @Param('source') source: string, @Param('id') id: string) {
    return this.webhookEvents.dismiss(webhookSource(source), id, adminId);
  }
}
