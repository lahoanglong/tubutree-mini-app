import { Global, Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyCron } from './loyalty.cron';

@Global()
@Module({
  controllers: [LoyaltyController],
  providers: [LoyaltyService, LoyaltyCron],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
