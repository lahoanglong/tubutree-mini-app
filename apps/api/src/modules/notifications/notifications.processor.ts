import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, type Job } from 'bullmq';
import { INAPP_RETRY_JOB, NotificationsService, type InAppRetryJobData, type ZnsSendJobData } from './notifications.service';
import { QUEUE_NOTIFICATIONS } from '../../jobs/queues';
import { captureServerError } from '../../config/sentry';

/**
 * Worker gửi ZNS. notify() chỉ ghi NotificationLog (PENDING) rồi xếp job vào QUEUE_NOTIFICATIONS, nên request đặt
 * hàng/thanh toán không chờ Zalo; mỗi lượt xử lý ghi kết quả (SENT / RETRYING / FAILED kèm mã lỗi + lý do) vào log.
 *
 * Đăng ký làm provider trong QueueModule (jobs/queue.module.ts) chứ không phải
 * NotificationsModule — chỉ cần là 1 provider Nest biết tới để BullMQ tạo Worker, không bắt
 * buộc phải nằm cùng module với registerQueue (giống ZaloOaEventsProcessor đăng ký trong
 * ZaloOaModule dù QUEUE_ZALO_OA_EVENTS chỉ registerQueue ở QueueModule — global). Phụ thuộc
 * duy nhất là NotificationsService (được NotificationsModule export + @Global()).
 *
 * Lịch thử lại do BullMQ quản qua ZNS_SEND_JOB_OPTIONS (notifications.service.ts). Chỉ lỗi tạm thời còn lượt mới ném
 * lỗi cho BullMQ; lỗi vĩnh viễn (số điện thoại, mẫu chưa duyệt, hết hạn mức...) đã được ghi FAILED nên job kết thúc
 * luôn, không đốt hết các lượt thử.
 */
@Processor(QUEUE_NOTIFICATIONS)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<ZnsSendJobData | InAppRetryJobData>, token?: string): Promise<void> {
    if (job.name === INAPP_RETRY_JOB) return this.retryInApp(job as Job<InAppRetryJobData>);
    return this.sendZns(job as Job<ZnsSendJobData>, token);
  }

  /** Tin trong app không dời theo giờ yên tĩnh ZNS. Mẫu kênh ZNS thì notify() tự dời phần ZNS qua job zns-send của nó. */
  private async retryInApp(job: Job<InAppRetryJobData>): Promise<void> {
    const { userId, templateCode, data, dedupeKey, context } = job.data;
    try {
      await this.notifications.notify(userId, templateCode, data, { dedupeKey });
    } catch (err) {
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= attempts) {
        this.logger.error(
          `Gửi tin ${templateCode} cho ${userId}${context ? ` (${context})` : ''} THẤT BẠI sau ${attempts} lượt: ${err instanceof Error ? err.message : String(err)}`,
        );
        captureServerError(err);
      }
      throw err;
    }
  }

  private async sendZns(job: Job<ZnsSendJobData>, token?: string): Promise<void> {
    // Lượt thử lại do BullMQ xếp theo backoff nên có thể rơi sau 21h dù lượt đầu đã được dời; dời tiếp tới hết giờ yên tĩnh.
    // moveToDelayed + DelayedError không tính là một lượt thử (attemptsMade giữ nguyên), và chạy trước deliverZns để log vẫn còn nguyên trạng thái.
    const quietMs = await this.notifications.quietDelayMs();
    if (quietMs > 0) {
      await job.moveToDelayed(Date.now() + quietMs, token);
      throw new DelayedError();
    }
    const attempts = job.opts.attempts ?? 1;
    const outcome = await this.notifications.deliverZns(job.data, job.attemptsMade + 1 >= attempts);
    if (outcome === 'SENT') return;
    if (outcome === 'SKIPPED') {
      this.logger.warn(`Bỏ qua job ZNS đến muộn của notificationLog ${job.data.notificationLogId}: log đã đóng và khoá đã nhả để gửi lại.`);
      return;
    }
    if (outcome === 'FAILED') {
      this.logger.error(`Gửi ZNS THẤT BẠI cho notificationLog ${job.data.notificationLogId} (xem cột error)`);
      return;
    }
    throw new Error('Gửi ZNS thất bại tạm thời, chờ BullMQ thử lại');
  }
}
