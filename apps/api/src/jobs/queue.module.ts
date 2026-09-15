import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { QUEUE_PANCAKE_EVENTS, QUEUE_NOTIFICATIONS, QUEUE_ZALO_OA_EVENTS, QUEUE_PANCAKE_PUSH } from './queues';
import { NotificationsProcessor } from '../modules/notifications/notifications.processor';

/**
 * Cấu hình BullMQ root (kết nối Redis qua REDIS_URL) + đăng ký các queue.
 * Worker retry: 5 lần, backoff exponential.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }) },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_PANCAKE_EVENTS },
      { name: QUEUE_NOTIFICATIONS },
      { name: QUEUE_ZALO_OA_EVENTS },
      { name: QUEUE_PANCAKE_PUSH },
    ),
  ],
  // NotificationsProcessor xử lý QUEUE_NOTIFICATIONS (retry gửi ZNS thất bại — xem
  // notifications.service.ts/notify()). Đăng ký ở đây thay vì NotificationsModule vì chỉ phụ
  // thuộc NotificationsService (được NotificationsModule export + @Global()); không cần
  // registerQueue lại vì QueueModule đã @Global() export toàn bộ Queue (cùng cách
  // ZaloOaEventsProcessor dùng QUEUE_ZALO_OA_EVENTS từ module khác).
  providers: [NotificationsProcessor],
  exports: [BullModule],
})
export class QueueModule {}
