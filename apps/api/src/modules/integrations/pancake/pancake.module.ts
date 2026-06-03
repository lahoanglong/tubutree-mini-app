import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PancakeClient } from './pancake.client';
import { PancakeSyncService } from './pancake-sync.service';
import { PancakeOrderService } from './pancake-order.service';
import { PancakeProcessor } from './pancake.processor';
import { PancakeWebhookController } from './pancake-webhook.controller';
import { PancakeController } from './pancake.controller';
import { QUEUE_PANCAKE_EVENTS } from '../../../jobs/queues';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_PANCAKE_EVENTS })],
  controllers: [PancakeWebhookController, PancakeController],
  providers: [PancakeClient, PancakeSyncService, PancakeOrderService, PancakeProcessor],
  exports: [PancakeClient, PancakeSyncService, PancakeOrderService],
})
export class PancakeModule {}
