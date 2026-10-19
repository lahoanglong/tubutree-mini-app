import { BadGatewayException, BadRequestException, Controller, Get, Logger, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@tubutree/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { OpsEmailService } from './ops-email.service';
import { smtpFailureHint } from './ops-email-error';
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
  private readonly logger = new Logger(OpsController.name);

  constructor(
    private readonly health: OpsHealthService,
    private readonly email: OpsEmailService,
    private readonly inbox: OpsInboxService,
    private readonly webhookEvents: OpsWebhookEventsService,
  ) {}

  /** Trang chủ "Việc cần xử lý": số việc ở từng hàng đợi — nhân viên chỉ thấy việc thuộc nhóm của mình. */
  @AllowStaff('CSKH', 'KHO', 'MARKETING', 'KE_TOAN')
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

  /**
   * Gửi một email thử tới OPS_ALERT_EMAIL_TO để kiểm tra SMTP. Không đụng trí nhớ chống báo lặp (không làm mất hay thêm báo
   * động thật). Chưa cấu hình/cấu hình dở dang → 400 nêu khoá còn thiếu; SMTP từ chối → 502 kèm lý do đã che bí mật (lỗi xác
   * thực/từ chối vĩnh viễn kèm cách sửa). Gửi được thì lượt kiểm sau tự gửi lại báo động đã bị chặn vì lỗi vĩnh viễn.
   */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('alert-email/test')
  async testAlertEmail(@CurrentUser('sub') adminId: string) {
    const r = await this.email.sendTest();
    if (!r.ok) {
      if (r.reason === 'SEND_FAILED') {
        const hint = smtpFailureHint(r.kind);
        throw new BadGatewayException(hint ? `Gửi email thử lỗi — ${hint} Chi tiết: ${r.error}` : `Gửi email thử lỗi: ${r.error}`);
      }
      throw new BadRequestException(r.error);
    }
    this.logger.warn(`Admin ${adminId} gửi email thử báo động vận hành (${r.recipients} địa chỉ nhận).`);
    return { ok: true as const, message: `Đã gửi email thử tới ${r.recipients} địa chỉ nhận. Kiểm tra hộp thư (cả thư rác) để xác nhận.` };
  }
}
