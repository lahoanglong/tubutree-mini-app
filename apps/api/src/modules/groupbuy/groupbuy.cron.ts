import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { GroupBuyService } from './groupbuy.service';

/** Quét nhóm mua chung quá hạn → FAILED (mỗi 15 phút). */
@Injectable()
export class GroupBuyCron {
  private readonly logger = new Logger(GroupBuyCron.name);
  constructor(private readonly groupBuy: GroupBuyService) {}

  @Cron('0 */15 * * * *')
  async sweep() {
    const n = await this.groupBuy.expireGroups();
    if (n > 0) this.logger.log(`Đã đánh dấu ${n} nhóm mua chung hết hạn → FAILED.`);
    // Đối soát: nhóm SUCCESS còn sót coupon (lỗi DB lúc cấp) → cấp lại idempotent.
    await this.groupBuy.reconcileSuccessfulGroups().catch((e) => this.logger.warn(`reconcile lỗi: ${(e as Error).message}`));
  }
}
