import { Global, Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyCron } from './loyalty.cron';
import { LoyaltyExpiryService } from './loyalty-expiry.service';
import { TierDropNoticeService } from './tier-drop-notice.service';
import { GoodwillCreditController } from './goodwill-credit.controller';
import { GoodwillCreditService } from './goodwill-credit.service';

@Global()
@Module({
  controllers: [LoyaltyController, GoodwillCreditController],
  providers: [LoyaltyService, LoyaltyCron, LoyaltyExpiryService, TierDropNoticeService, GoodwillCreditService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
