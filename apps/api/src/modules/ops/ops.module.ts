import { Module } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  QUEUE_GOMDON_EVENTS,
  QUEUE_GOMDON_PUSH,
  QUEUE_NOTIFICATIONS,
  QUEUE_PANCAKE_EVENTS,
  QUEUE_PANCAKE_PUSH,
  QUEUE_ZALO_OA_EVENTS,
} from '../../jobs/queues';
import { GomdonModule } from '../integrations/gomdon/gomdon.module';
import { MerchantModule } from '../merchant/merchant.module';
import { OpsController } from './ops.controller';
import { OPS_QUEUES, OpsHealthService } from './ops-health.service';
import { OpsInboxService } from './ops-inbox.service';

const QUEUES = [QUEUE_PANCAKE_PUSH, QUEUE_PANCAKE_EVENTS, QUEUE_GOMDON_PUSH, QUEUE_GOMDON_EVENTS, QUEUE_NOTIFICATIONS, QUEUE_ZALO_OA_EVENTS];

@Module({
  imports: [GomdonModule, MerchantModule],
  controllers: [OpsController],
  providers: [
    { provide: OPS_QUEUES, inject: QUEUES.map((q) => getQueueToken(q)), useFactory: (...queues: Queue[]) => queues },
    OpsHealthService,
    OpsInboxService,
  ],
  exports: [OpsHealthService],
})
export class OpsModule {}
