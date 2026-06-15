import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PancakeClient } from './pancake.client';
import { PancakeSyncService } from './pancake-sync.service';
import { PancakeOrderService } from './pancake-order.service';
import { PancakeProcessor } from './pancake.processor';
import { PancakeWebhookController } from './pancake-webhook.controller';
import { PancakeController } from './pancake.controller';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';
import { QUEUE_PANCAKE_EVENTS } from '../../../jobs/queues';
import { LifecycleModule } from '../../lifecycle/lifecycle.module';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_PANCAKE_EVENTS }), LifecycleModule],
  controllers: [PancakeWebhookController, PancakeController, GeoController],
  providers: [PancakeClient, PancakeSyncService, PancakeOrderService, PancakeProcessor, GeoService],
  exports: [PancakeClient, PancakeSyncService, PancakeOrderService],
})
export class PancakeModule {}
