import { Module } from '@nestjs/common';
import { GiftTrialService } from './gift-trial.service';

@Module({
  providers: [GiftTrialService],
  exports: [GiftTrialService],
})
export class GiftTiersModule {}
