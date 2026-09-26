import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DealerService } from './dealer.service';

/** Trả thưởng doanh số quý cho đại lý vào ngày 10 tháng đầu mỗi quý (10/01, 10/04, 10/07, 10/10). */
@Injectable()
export class DealerCron {
  private readonly logger = new Logger(DealerCron.name);
  constructor(private readonly dealer: DealerService) {}

  // 04:00 ngày 10 của tháng 1,4,7,10 — trả thưởng cho quý vừa kết thúc. Thưởng chỉ tính đơn đã
  // chốt (đã thanh toán/ghi công nợ + đã đóng gói trở đi); trước đây chạy ngày 1 nên đơn đặt vài
  // ngày cuối quý chưa kịp đóng gói sẽ bị loại vĩnh viễn (payout idempotent, chỉ chạy 1 lần/quý).
  @Cron('0 0 4 10 1,4,7,10 *')
  async payoutQuarterly() {
    try {
      const { paid, quarter } = await this.dealer.payoutQuarterlyBonuses();
      this.logger.log(`Cron thưởng quý ${quarter}: đã trả ${paid} đại lý.`);
    } catch (err) {
      this.logger.error(`Cron trả thưởng quý lỗi: ${err instanceof Error ? err.stack ?? err.message : err}`);
    }
  }
}
