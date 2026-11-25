import { Global, Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_PANCAKE_PUSH } from '../../../jobs/queues';
import { CatalogSyncModule } from '../mss-catalog-sync/catalog-sync.module';
import { PancakeModule } from '../pancake/pancake.module';
import { MssCatalogModule } from './catalog/mss-catalog.module';
import { CommerceBackendResolver } from './commerce-backend.resolver';
import { BullRedisSharedStore, MSS_SHARED_STORE } from './mss-circuit';
import { MssFlagsService } from './mss-flags';
import { MssHealthService } from './mss-health.service';
import { MssInboundGuard } from './mss-inbound.guard';
import { MssClient } from './mss.client';
import { MSS_ORDER_EVENTS_QUEUE } from './mss-order-event-types';
import { MssCartEventRecorder } from './mss-cart-event.recorder';
import { MssCartEventSender } from './mss-cart-event.sender';
import { MssOrderEventDispatcher } from './mss-order-event.dispatch';
import { MssOrderEventFallback } from './mss-order-event.fallback';
import { MssOrderEventRecorder } from './mss-order-event.recorder';
import { MssOrderEventSender } from './mss-order-event.sender';
import { MssOrderEventsAdminController, MssOrderEventsOpsService } from './mss-order-events.admin';
import { MssOrderEventsCallbackController } from './mss-order-events.controller';
import { MssOrderEventsProcessor } from './mss-order-events.processor';
import { MssOrderEventReconcileService } from './mss-order-events.reconcile';
import { MSS_ZNS_HOLD, MssZnsHoldService } from './mss-zns-hold';

/**
 * Kết nối MSS (quyết định PO số 5, kiểu strangler): cấu hình, cờ, ký/kiểm HMAC, client có cầu dao, dò sức khoẻ, bộ chọn đường đơn, và
 * luồng sự kiện đơn gửi MSS (outbox, worker, callback, đối soát, luật hoãn ZNS), và sự kiện giỏ bỏ quên (`/cart-events`, cron 5 phút). Cờ tắt hay thiếu biến thì không có lời gọi MSS nào và
 * hành vi Tubu không đổi; vẫn có hàng đợi `mss-order-events` (kết nối Redis của BullMQ như mọi hàng đợi khác, worker rảnh) và hai cron
 * quét bù/đối soát chạy một câu SELECT trên bảng outbox rỗng.
 *
 * @Global: checkout, orders, thanh toán, đại lý và notifications tiêm MssOrderEventRecorder / MSS_ZNS_HOLD (@Optional) mà không import
 * module này, tránh vòng import với PancakeModule.
 *
 * Kho chung của cầu dao đi qua client Redis của Queue `pancake-push` mà QueueModule (@Global) đã tạo, giống HealthController ping Redis;
 * chỉ GET/SET/DEL trên khoá `tubu:mss:*`.
 */
@Global()
@Module({
  imports: [PancakeModule, BullModule.registerQueue({ name: MSS_ORDER_EVENTS_QUEUE }), MssCatalogModule, CatalogSyncModule],
  controllers: [MssOrderEventsCallbackController, MssOrderEventsAdminController],
  providers: [
    { provide: MSS_SHARED_STORE, inject: [getQueueToken(QUEUE_PANCAKE_PUSH)], useFactory: (q: Queue) => new BullRedisSharedStore(q) },
    MssFlagsService,
    MssClient,
    MssHealthService,
    MssInboundGuard,
    CommerceBackendResolver,
    MssOrderEventDispatcher,
    MssOrderEventRecorder,
    MssOrderEventFallback,
    MssOrderEventSender,
    MssOrderEventsProcessor,
    MssOrderEventReconcileService,
    MssOrderEventsOpsService,
    MssZnsHoldService,
    { provide: MSS_ZNS_HOLD, useExisting: MssZnsHoldService },
    MssCartEventRecorder,
    MssCartEventSender,
  ],
  exports: [MssFlagsService, MssClient, MssHealthService, MssInboundGuard, CommerceBackendResolver, MssOrderEventRecorder, MSS_ZNS_HOLD, MssCartEventRecorder],
})
export class MssModule {}
