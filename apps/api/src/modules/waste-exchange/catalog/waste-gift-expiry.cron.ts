import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CRON_TZ } from '../../../common/cron-tz';
import { markCronSkipped, TrackCron } from '../../../common/cron-run/track-cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteGiftRedemptionsService } from './waste-gift-redemptions.service';

/** Mỗi giờ huỷ quà hiện vật đã quá hạn nhận và hoàn điểm cho khách. Cờ đổi rác tắt thì không chạy, giống các cron đổi rác khác. */
@Injectable()
export class WasteGiftExpiryCron {
  private readonly logger = new Logger(WasteGiftExpiryCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly gifts: WasteGiftRedemptionsService,
  ) {}

  // @Cron không tự bắt lỗi: lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 15 * * * *', { name: 'waste.gift-expiry', timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 2 })
  async handleCron(): Promise<void> {
    try {
      const res = await this.run();
      if (res.expired > 0 || res.failed > 0) this.logger.log(`Quà quá hạn nhận: huỷ và hoàn điểm ${res.expired}, lỗi ${res.failed}.`);
    } catch (err) {
      this.logger.error(`Cron huỷ quà quá hạn nhận lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
  }

  async run(now: Date = new Date()): Promise<{ expired: number; failed: number }> {
    const none = { expired: 0, failed: 0 };
    if (this.running) { markCronSkipped('RUNNING'); return none; }
    this.running = true;
    try {
      const cfg = await this.config.snapshot();
      if (!cfg.enabled) { markCronSkipped('NOT_CONFIGURED'); return none; }
      // Khoá advisory theo transaction giữ suốt lượt chạy: hai replica cùng lên lịch thì chỉ một bên quét. Từng quà huỷ trên
      // kết nối khác; tx này chỉ để giữ khoá. Khoá viết thẳng trong SQL để cổng quét khoá thấy `hashtext('cron:`.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext('cron:waste.gift_expiry')) AS "locked"`;
          if (!row?.locked) { markCronSkipped('LOCKED'); return none; }
          return this.gifts.expireOverdue(now);
        },
        { maxWait: 10_000, timeout: 15 * 60_000 },
      );
    } finally {
      this.running = false;
    }
  }
}
