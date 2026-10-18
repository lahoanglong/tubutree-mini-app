import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { backfillChatClaims, lapseExpiredChatClaims, linkClaimsByPhone, linkWaitingClaims, type LinkableUser, type LinkResult } from './external-chat.claim';

/**
 * Cửa vào cho phần đơn chat/điện thoại (B9): AuthService gọi `linkByPhone` sau mỗi lần cấp phiên, cron 30 phút gọi `sweep`.
 * Mọi hàm nuốt lỗi: tích điểm không bao giờ được làm rớt đăng nhập hay làm hỏng lượt cron của việc khác.
 */
@Injectable()
export class ExternalChatService {
  private readonly logger = new Logger(ExternalChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** Liên kết claim chat đang chờ của SĐT (đã xác minh) với thành viên vừa đăng nhập. Cờ tắt hoặc không có claim chờ thì gần như không tốn gì. */
  async linkByPhone(user: LinkableUser): Promise<LinkResult> {
    return linkClaimsByPhone(this.prisma, { config: this.config, notifier: this.notifications }, user);
  }

  /** Mỗi 30 phút: liên kết bù, tạo claim bù cho đơn nạp lúc cờ tắt, rồi cho claim quá hạn giữ hết hiệu lực. */
  async sweep(now: Date = new Date()): Promise<{ linked: number; created: number; lapsed: number }> {
    const deps = { config: this.config, notifier: this.notifications };
    const result = { linked: 0, created: 0, lapsed: 0 };
    try {
      result.created = await backfillChatClaims(this.prisma, deps, now);
      result.linked = await linkWaitingClaims(this.prisma, deps, now);
      result.lapsed = await lapseExpiredChatClaims(this.prisma, this.config, now);
    } catch (err) {
      this.logger.error(`Quét điểm đơn chat lỗi: ${err instanceof Error ? err.message : err}`);
    }
    return result;
  }
}
