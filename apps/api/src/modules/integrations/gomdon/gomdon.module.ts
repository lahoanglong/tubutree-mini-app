import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GomdonClientModule } from './gomdon-client.module';
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
import { WasteHomePickupModule } from '../../waste-exchange/home-pickup/waste-home-pickup.module';
import { GomdonWastePickupService } from './gomdon-waste-pickup.service';
import { GomdonWasteReconcileService } from './gomdon-waste-reconcile.service';

/**
 * Phụ thuộc MỘT chiều Gomdon → Pancake (đẩy đơn sang kho sau khi có vận đơn). Các module khác
 * (pancake, payment, orders) chỉ enqueue qua gomdon-queue.ts + @InjectQueue — không import module
 * này, nên không còn vòng forwardRef Pancake ↔ Gomdon.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_GOMDON_PUSH }, { name: QUEUE_GOMDON_EVENTS }),
    GomdonClientModule,
    PancakeModule,
    OrdersModule,
    WasteHomePickupModule,
  ],
  controllers: [GomdonWebhookController],
  providers: [
    GomdonOrderService,
    GomdonPushProcessor,
    GomdonWebhookService,
    GomdonEventsProcessor,
    GomdonReconcileService,
    GomdonAlertService,
    GomdonWastePickupService,
    GomdonWasteReconcileService,
  ],
  exports: [GomdonClientModule, GomdonOrderService],
})
export class GomdonModule {}
