import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CRON_TZ } from '../../../common/cron-tz';
import { markCronSkipped, TrackCron } from '../../../common/cron-run/track-cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteGiftRedemptionsService } from './waste-gift-redemptions.service';

/**
 * Mỗi giờ huỷ quà hiện vật đã quá hạn nhận và hoàn điểm cho khách. Chạy bất kể cờ đổi rác: đổi quà và trao quà ở kho không theo cờ đó,
 * nên quà quá hạn phải được huỷ kể cả khi chương trình đang tạm dừng, không thì điểm của khách bị giữ mãi.
 */
@Injectable()
export class WasteGiftExpiryCron {
  private readonly logger = new Logger(WasteGiftExpiryCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gifts: WasteGiftRedemptionsService,
  ) {}

  // @Cron không tự bắt lỗi: lỗi ném ra ngoài là unhandledRejection.
  @Cron('0 15 * * * *', { name: 'waste.gift-expiry', timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 2 })
  async handleCron(): Promise<void> {
    try {
      const res = await this.run();
      if (res.expired > 0 || res.failed > 0 || res.held > 0) this.logger.log(`Quà quá hạn nhận: huỷ và hoàn điểm ${res.expired}, để admin xử lý ${res.held}, lỗi ${res.failed}.`);
    } catch (err) {
      this.logger.error(`Cron huỷ quà quá hạn nhận lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
  }

  async run(now: Date = new Date()): Promise<{ expired: number; failed: number; held: number }> {
    const none = { expired: 0, failed: 0, held: 0 };
    if (this.running) { markCronSkipped('RUNNING'); return none; }
    this.running = true;
    try {
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
