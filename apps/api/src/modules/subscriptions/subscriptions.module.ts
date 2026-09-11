import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { PancakeModule } from '../integrations/pancake/pancake.module';

// Pricing/Loyalty/SystemConfig/Notifications đều @Global — không cần import.
@Module({
  imports: [PancakeModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
})
export class SubscriptionsModule {}
