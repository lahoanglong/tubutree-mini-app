import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';

// Pricing/Loyalty/SystemConfig/Notifications đều @Global — không cần import.
@Module({
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
})
export class SubscriptionsModule {}
