import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PancakeOrderService } from './pancake-order.service';
import { QUEUE_PANCAKE_PUSH } from '../../../jobs/queues';

/**
 * Worker đẩy đơn local → Pancake (outbound). Retry+backoff (5 lần, exponential 2s) do
 * BullMQ tự quản qua defaultJobOptions (jobs/queue.module.ts) — không cần tự cài retry
 * ở đây. Ném lỗi tiếp để BullMQ đếm attempt; chỉ log ở lần thất bại CUỐI (job.attemptsMade
 * đạt job.opts.attempts) để không spam log cho các lần retry giữa chừng.
 */
@Processor(QUEUE_PANCAKE_PUSH)
export class PancakePushProcessor extends WorkerHost {
  private readonly logger = new Logger(PancakePushProcessor.name);

  constructor(private readonly pancakeOrder: PancakeOrderService) {
    super();
  }

  async process(job: Job<{ orderId: string }>): Promise<void> {
    try {
      await this.pancakeOrder.pushOrder(job.data.orderId);
    } catch (err) {
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= attempts) {
        this.logger.error(
          `Đẩy Pancake THẤT BẠI sau ${attempts} lần cho đơn ${job.data.orderId}: ${err instanceof Error ? err.message : err}`,
        );
      }
      throw err; // BullMQ retry theo defaultJobOptions
    }
  }
}
