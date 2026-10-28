import { Global, Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyCron } from './loyalty.cron';
import { LoyaltyExpiryService } from './loyalty-expiry.service';
import { TierDropNoticeService } from './tier-drop-notice.service';

@Global()
@Module({
  controllers: [LoyaltyController],
  providers: [LoyaltyService, LoyaltyCron, LoyaltyExpiryService, TierDropNoticeService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
