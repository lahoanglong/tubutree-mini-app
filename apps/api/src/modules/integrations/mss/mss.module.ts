import { Module } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_PANCAKE_PUSH } from '../../../jobs/queues';
import { PancakeModule } from '../pancake/pancake.module';
import { CommerceBackendResolver } from './commerce-backend.resolver';
import { BullRedisSharedStore, MSS_SHARED_STORE } from './mss-circuit';
import { MssFlagsService } from './mss-flags';
import { MssHealthService } from './mss-health.service';
import { MssInboundGuard } from './mss-inbound.guard';
import { MssClient } from './mss.client';

/**
 * Nền kết nối MSS (quyết định PO số 5, kiểu strangler): cấu hình, cờ, ký/kiểm HMAC, client có cầu dao, dò sức khoẻ, bộ chọn đường
 * đơn. Không có route nào, không đăng ký MssBackend: cờ tắt hay thiếu biến thì không có lời gọi MSS nào và hành vi Tubu không đổi.
 *
 * Kho chung đi qua client Redis của Queue `pancake-push` mà QueueModule (@Global) đã tạo, giống HealthController ping Redis: không mở
 * kết nối mới, không thêm hàng đợi hay job; chỉ GET/SET/DEL trên khoá `tubu:mss:*`.
 */
@Module({
  imports: [PancakeModule],
  providers: [
    { provide: MSS_SHARED_STORE, inject: [getQueueToken(QUEUE_PANCAKE_PUSH)], useFactory: (q: Queue) => new BullRedisSharedStore(q) },
    MssFlagsService,
    MssClient,
    MssHealthService,
    MssInboundGuard,
    CommerceBackendResolver,
  ],
  exports: [MssFlagsService, MssClient, MssHealthService, MssInboundGuard, CommerceBackendResolver],
})
export class MssModule {}
