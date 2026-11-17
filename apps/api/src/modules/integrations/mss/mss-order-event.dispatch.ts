import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { withQueueTimeout } from '../../../jobs/queue-timeout';
import { MSS_ORDER_EVENT_JOB, MSS_ORDER_EVENTS_QUEUE } from './mss-order-event-types';

export interface MssOrderEventJobData {
  eventId: string;
}

/**
 * Lịch thử lại gửi MSS nằm ở outbox (mỗi lượt một job mới), không ở BullMQ. Vài lượt thử của chính job chỉ để chờ transaction
 * nghiệp vụ commit: job được xếp từ trong transaction nên có thể chạy trước khi dòng outbox hiện ra.
 */
export const MSS_ORDER_EVENT_JOB_OPTIONS = {
  attempts: 4,
  backoff: { type: 'fixed' as const, delay: 3_000 },
  removeOnComplete: 1000,
  removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
};

/** Trễ của job đầu tiên: đủ để transaction đặt hàng/đổi trạng thái commit trong đa số trường hợp. */
export const MSS_FIRST_JOB_DELAY_MS = 1_500;

/** jobId theo lượt: BullMQ giữ job đã xong nên jobId cố định sẽ chặn lượt thử lại sau. BullMQ cấm dấu `:` trong jobId tự đặt. */
export function mssOrderEventJobId(eventId: string, attempt: number): string {
  return `mss-${eventId}-${attempt}`;
}

@Injectable()
export class MssOrderEventDispatcher {
  private readonly logger = new Logger(MssOrderEventDispatcher.name);

  constructor(@InjectQueue(MSS_ORDER_EVENTS_QUEUE) private readonly queue: Queue) {}

  /**
   * Không chờ và không ném: Redis chậm hay hỏng không được kéo dài transaction đặt hàng. Xếp hàng hỏng thì cron quét bù
   * (MssOrderEventReconcileService) tự gửi dòng PENDING đã tới hạn.
   */
  enqueue(eventId: string, attempt: number, delayMs: number): void {
    const job: MssOrderEventJobData = { eventId };
    void withQueueTimeout(
      this.queue.add(MSS_ORDER_EVENT_JOB, job, { ...MSS_ORDER_EVENT_JOB_OPTIONS, jobId: mssOrderEventJobId(eventId, attempt), delay: Math.max(0, Math.round(delayMs)) }),
      `${MSS_ORDER_EVENTS_QUEUE} ${eventId}`,
    ).catch((err: unknown) => {
      this.logger.warn(`Không xếp được job gửi MSS ${eventId} (cron quét bù sẽ gửi): ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}
