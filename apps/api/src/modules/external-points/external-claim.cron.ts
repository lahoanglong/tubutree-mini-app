import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CRON_TZ } from '../../common/cron-tz';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { ExternalClaimPollService } from './external-claim-poll.service';
import { releaseDueClaims } from './external-claim-release';
import { ExternalClaimService } from './external-claim.service';

/**
 * Hai cron của điểm đơn ngoài app. Cron chỉ chạy trên instance giữ lease (CronLeaderService); mỗi việc còn tự an toàn khi chạy chồng
 * (khoá advisory cho lượt cộng, điều kiện trạng thái cho từng claim). Lỗi không bao giờ ném ra khỏi @Cron.
 */
@Injectable()
export class ExternalClaimCron {
  private readonly logger = new Logger(ExternalClaimCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
    private readonly claims: ExternalClaimService,
    private readonly poll: ExternalClaimPollService,
  ) {}

  /** Mỗi 30 phút: ghép lại lần gửi mã chưa thấy đơn, rồi cộng claim tới hạn. */
  @Cron('0 */30 * * * *', { timeZone: CRON_TZ })
  async everyThirtyMinutes(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.claims.rematchUnmatched();
      if (r.matched > 0 || r.resolved > 0) this.logger.log(`Ghép lại mã chưa thấy đơn: khớp ${r.matched}, xử lý xong ${r.resolved}`);
      const c = await releaseDueClaims(this.prisma, this.config, this.notifications);
      if (c.credited > 0 || c.toReview > 0) this.logger.log(`Cộng điểm đơn ngoài app: ${c.credited} claim, ${c.toReview} chuyển REVIEW`);
    } catch (err) {
      this.logger.error(`Cron điểm đơn ngoài app lỗi: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.running = false;
    }
  }

  /** Mỗi 10 phút: kéo dự phòng (cờ tắt thì không làm gì). */
  @Cron('0 */10 * * * *', { timeZone: CRON_TZ })
  async pollFallback(): Promise<void> {
    try {
      await this.poll.pollOnce();
    } catch (err) {
      this.logger.error(`Cron kéo dự phòng đơn ngoài lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }
}
