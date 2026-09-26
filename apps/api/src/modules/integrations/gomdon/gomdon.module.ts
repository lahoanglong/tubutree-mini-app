import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GomdonClient } from './gomdon.client';
import { GomdonOrderService } from './gomdon-order.service';
import { GomdonPushProcessor } from './gomdon-push.processor';
import { GomdonWebhookController } from './gomdon-webhook.controller';
import { GomdonWebhookService } from './gomdon-webhook.service';
import { GomdonEventsProcessor } from './gomdon-events.processor';
import { GomdonReconcileService } from './gomdon-reconcile.service';
import { GomdonAlertService } from './gomdon-alert.service';
import { QUEUE_GOMDON_EVENTS, QUEUE_GOMDON_PUSH } from '../../../jobs/queues';
import { PancakeModule } from '../pancake/pancake.module';
import { OrdersModule } from '../../orders/orders.module';

/**
 * Phụ thuộc MỘT chiều Gomdon → Pancake (đẩy đơn sang kho sau khi có vận đơn). Các module khác
 * (pancake, payment, orders) chỉ enqueue qua gomdon-queue.ts + @InjectQueue — không import module
 * này, nên không còn vòng forwardRef Pancake ↔ Gomdon.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_GOMDON_PUSH }, { name: QUEUE_GOMDON_EVENTS }),
    PancakeModule,
    OrdersModule,
  ],
  controllers: [GomdonWebhookController],
  providers: [
    GomdonClient,
    GomdonOrderService,
    GomdonPushProcessor,
    GomdonWebhookService,
    GomdonEventsProcessor,
    GomdonReconcileService,
    GomdonAlertService,
  ],
  exports: [GomdonClient, GomdonOrderService],
})
export class GomdonModule {}
