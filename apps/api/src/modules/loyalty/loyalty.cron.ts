import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LoyaltyService } from './loyalty.service';

/** Tính lại hạng thành viên hằng đêm (áp rớt hạng sau khi hết ân hạn §6.6). */
@Injectable()
export class LoyaltyCron {
  private readonly logger = new Logger(LoyaltyCron.name);
  constructor(private readonly loyalty: LoyaltyService) {}

  // 03:15 mỗi ngày — sau các cron settle khác (vouchers 02:00, subscriptions 03:00).
  @Cron('0 15 3 * * *')
  async recalcTiers() {
    const n = await this.loyalty.recalcAllTiers();
    this.logger.log(`Đã tính lại hạng cho ${n} thành viên.`);
  }
}
