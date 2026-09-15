import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { NotificationsService, ZnsRetryJobData } from './notifications.service';
import { QUEUE_NOTIFICATIONS } from '../../jobs/queues';

/**
 * Worker retry gửi ZNS khi notify() gửi đồng bộ thất bại (Fix High): trước đây lỗi mạng 1 lần
 * bị ghi NotificationLog status FAILED rồi bỏ qua vĩnh viễn, không ai gửi lại. notify() nay
 * enqueue job này vào QUEUE_NOTIFICATIONS ngay sau lần gửi đồng bộ đầu thất bại.
 *
 * Đăng ký làm provider trong QueueModule (jobs/queue.module.ts) chứ không phải
 * NotificationsModule — chỉ cần là 1 provider Nest biết tới để BullMQ tạo Worker, không bắt
 * buộc phải nằm cùng module với registerQueue (giống ZaloOaEventsProcessor đăng ký trong
 * ZaloOaModule dù QUEUE_ZALO_OA_EVENTS chỉ registerQueue ở QueueModule — global). Phụ thuộc
 * duy nhất là NotificationsService (được NotificationsModule export + @Global()).
 *
 * Retry+backoff (5 lần, exponential 2s) do BullMQ tự quản qua defaultJobOptions
 * (jobs/queue.module.ts) — không tự cài lại ở đây. Chỉ log ở lần thất bại CUỐI, luôn rethrow để
 * BullMQ đếm attempt đúng (cùng kiểu với pancake-push.processor.ts).
 */
@Processor(QUEUE_NOTIFICATIONS)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<ZnsRetryJobData>): Promise<void> {
    const ok = await this.notifications.retryZnsSend(job.data);
    if (ok) return;

    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade + 1 >= attempts) {
      this.logger.error(
        `Gửi lại ZNS THẤT BẠI sau ${attempts} lần cho notificationLog ${job.data.notificationLogId}`,
      );
    }
    throw new Error('Gửi ZNS thất bại, chờ BullMQ retry'); // BullMQ retry theo defaultJobOptions
  }
}
