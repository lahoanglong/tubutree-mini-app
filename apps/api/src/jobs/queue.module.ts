import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { QUEUE_PANCAKE_EVENTS, QUEUE_NOTIFICATIONS } from './queues';

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
    BullModule.registerQueue({ name: QUEUE_PANCAKE_EVENTS }, { name: QUEUE_NOTIFICATIONS }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
