import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CRON_TZ } from '../../../common/cron-tz';
import { markCronSkipped, TrackCron } from '../../../common/cron-run/track-cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteGiftAttachService } from './waste-gift-attach.service';
import { WasteGiftRedemptionsService } from './waste-gift-redemptions.service';
import { runExclusive } from '../../../common/cron-leader/run-exclusive';

/**
 * Mỗi giờ huỷ quà hiện vật đã quá hạn nhận và hoàn điểm cho khách. Chạy bất kể cờ đổi rác: đổi quà và trao quà ở kho không theo cờ đó,
 * nên quà quá hạn phải được huỷ kể cả khi chương trình đang tạm dừng, không thì điểm của khách bị giữ mãi.
 * Quà đang gắn một đơn mua chưa chốt không bị huỷ; quét bù gắn-đơn chạy trước để quà của đơn đã huỷ/trả được nhả rồi mới xét hạn.
 */
@Injectable()
export class WasteGiftExpiryCron {
  private readonly logger = new Logger(WasteGiftExpiryCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gifts: WasteGiftRedemptionsService,
    private readonly attach: WasteGiftAttachService,
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
      // Khoá lượt chạy (cron_leases), không giữ kết nối DB: nhiều instance cùng lên lịch thì chỉ một chạy.
      const run = await runExclusive(this.prisma, 'cron:waste.gift_expiry', async () => {
        await this.reconcileAttached();
        return this.gifts.expireOverdue(now);
      });
      if (!run.acquired) { markCronSkipped('LOCKED'); return none; }
      return run.value;
    } finally {
      this.running = false;
    }
  }

  // Lỗi quét bù không được chặn việc huỷ quà quá hạn.
  private async reconcileAttached(): Promise<void> {
    try {
      const res = await this.attach.reconcile();
      if (res.fulfilled > 0 || res.released > 0) this.logger.log(`Quét bù quà gắn đơn: hoàn tất ${res.fulfilled}, nhả ${res.released}.`);
    } catch (err) {
      this.logger.error(`Quét bù quà gắn đơn lỗi: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    }
  }
}
