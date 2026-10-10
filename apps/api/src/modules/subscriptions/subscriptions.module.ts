import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { PancakeModule } from '../integrations/pancake/pancake.module';
import { WalletModule } from '../wallet/wallet.module';

// Pricing/Loyalty/SystemConfig/Notifications đều @Global — không cần import.
@Module({
  imports: [PancakeModule, WalletModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
