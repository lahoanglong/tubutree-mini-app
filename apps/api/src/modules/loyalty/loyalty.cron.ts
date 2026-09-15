import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LoyaltyService } from './loyalty.service';

/** Tính lại hạng thành viên hằng đêm (áp rớt hạng sau khi hết ân hạn §6.6). */
@Injectable()
export class LoyaltyCron {
  private readonly logger = new Logger(LoyaltyCron.name);
  /** Chặn 2 lượt recalcTiers chạy chồng trong cùng 1 instance (job có thể chạy lâu hơn 1 ngày). */
  private running = false;
  constructor(private readonly loyalty: LoyaltyService) {}

  // 03:15 mỗi ngày — sau các cron settle khác (vouchers 02:00, subscriptions 03:00).
  @Cron('0 15 3 * * *')
  async recalcTiers() {
    if (this.running) {
      this.logger.warn('recalcTiers đang chạy, bỏ qua lượt này.');
      return;
    }
    this.running = true;
    try {
      const n = await this.loyalty.recalcAllTiers();
      this.logger.log(`Đã tính lại hạng cho ${n} thành viên.`);
    } catch (err) {
      this.logger.error(`Cron tính lại hạng lỗi: ${err instanceof Error ? err.stack ?? err.message : err}`);
    } finally {
      this.running = false;
    }
  }
}
