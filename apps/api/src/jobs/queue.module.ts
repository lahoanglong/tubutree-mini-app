import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { QUEUE_PANCAKE_EVENTS, QUEUE_NOTIFICATIONS, QUEUE_ZALO_OA_EVENTS, QUEUE_PANCAKE_PUSH, QUEUE_GOMDON_PUSH, QUEUE_GOMDON_EVENTS, QUEUE_SUPPORT_CHAT_FORWARD, QUEUE_SUPPORT_CHAT_NOTIFY } from './queues';
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
          // Redis chạy noeviction với trần bộ nhớ (docker-compose.vietnix.yml): job thất bại kèm
          // stacktrace × 6 queue không được giữ quá nhiều. Trạng thái thật nằm ở DB (orders.pancakeOrderId,
          // orders.gomdonStatus/gomdonCancelStatus, *_webhook_events, notification_logs) cho cron/admin.
          removeOnFail: 1000,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_PANCAKE_EVENTS },
      { name: QUEUE_NOTIFICATIONS },
      { name: QUEUE_ZALO_OA_EVENTS },
      { name: QUEUE_PANCAKE_PUSH },
      { name: QUEUE_GOMDON_PUSH },
      { name: QUEUE_GOMDON_EVENTS },
      { name: QUEUE_SUPPORT_CHAT_FORWARD },
      { name: QUEUE_SUPPORT_CHAT_NOTIFY },
    ),
  ],
  // NotificationsProcessor xử lý QUEUE_NOTIFICATIONS (gửi ZNS + thử lại lỗi tạm thời — xem
  // notifications.service.ts/notify()). Đăng ký ở đây thay vì NotificationsModule vì chỉ phụ
  // thuộc NotificationsService (được NotificationsModule export + @Global()); không cần
  // registerQueue lại vì QueueModule đã @Global() export toàn bộ Queue (cùng cách
  // ZaloOaEventsProcessor dùng QUEUE_ZALO_OA_EVENTS từ module khác).
  providers: [NotificationsProcessor],
  exports: [BullModule],
})
export class QueueModule {}
