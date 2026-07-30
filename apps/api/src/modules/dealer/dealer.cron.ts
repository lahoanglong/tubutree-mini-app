import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DealerService } from './dealer.service';

/** Trả thưởng doanh số quý cho đại lý vào đầu mỗi quý (01/01, 01/04, 01/07, 01/10). */
@Injectable()
export class DealerCron {
  private readonly logger = new Logger(DealerCron.name);
  constructor(private readonly dealer: DealerService) {}

  // 04:00 ngày 1 của tháng 1,4,7,10 — trả thưởng cho quý vừa kết thúc.
  @Cron('0 0 4 1 1,4,7,10 *')
  async payoutQuarterly() {
    const { paid, quarter } = await this.dealer.payoutQuarterlyBonuses();
    this.logger.log(`Cron thưởng quý ${quarter}: đã trả ${paid} đại lý.`);
  }
}
