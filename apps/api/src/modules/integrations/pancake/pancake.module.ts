import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PancakeClient } from './pancake.client';
import { PancakeSyncService } from './pancake-sync.service';
import { PancakeOrderService } from './pancake-order.service';
import { PancakeProcessor } from './pancake.processor';
import { PancakePushProcessor } from './pancake-push.processor';
import { PancakePushReconcileService } from './pancake-push-reconcile.service';
import { PancakeWebhookController } from './pancake-webhook.controller';
import { PancakeController } from './pancake.controller';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';
import { QUEUE_PANCAKE_EVENTS, QUEUE_PANCAKE_PUSH } from '../../../jobs/queues';
import { LifecycleModule } from '../../lifecycle/lifecycle.module';
import { OrdersModule } from '../../orders/orders.module';
import { GomdonAlertService } from '../gomdon/gomdon-alert.service';

/**
 * GomdonAlertService (báo ADMIN in-app, template OPS_GOMDON_ALERT) được provide LẠI ở đây thay vì import
 * GomdonModule: Gomdon → Pancake là phụ thuộc một chiều, import ngược sẽ thành vòng module. Service chỉ
 * cần PrismaService + NotificationsService (đều @Global) nên một bản riêng cho module này là đủ.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_PANCAKE_EVENTS }, { name: QUEUE_PANCAKE_PUSH }),
    LifecycleModule,
    OrdersModule,
  ],
  controllers: [PancakeWebhookController, PancakeController, GeoController],
  providers: [
    PancakeClient,
    PancakeSyncService,
    PancakeOrderService,
    PancakeProcessor,
    PancakePushProcessor,
    PancakePushReconcileService,
    GeoService,
    GomdonAlertService,
  ],
  exports: [PancakeClient, PancakeSyncService, PancakeOrderService],
})
export class PancakeModule {}
