import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { INAPP_RETRY_JOB, NotificationsService, oneLineReason, ZNS_SEND_JOB, type InAppRetryJobData, type ZnsSendJobData } from './notifications.service';
import { QUEUE_NOTIFICATIONS, QUEUE_NOTIFICATIONS_INAPP_RETRY } from '../../jobs/queues';
import { captureServerError } from '../../config/sentry';

/**
 * concurrency 5: mỗi job chủ yếu chờ Zalo (tối đa 25 giây), một worker tuần tự (mặc định 1) dồn hàng khi chiến dịch gửi hàng loạt.
 * limiter 10 job/giây là mức TỰ CHỌN thận trọng, không phải con số của Zalo: tài liệu ZNS công bố hạn mức theo ngày của OA
 * (xem API "Lấy thông tin quota ZNS"), không công bố trần theo giây. Hết hạn mức ngày thì Zalo trả lỗi nhóm hạn mức, đã được
 * coi là lỗi vĩnh viễn (zns-result). Nâng limiter chỉ khi đo thấy hàng đợi tồn mà Zalo không từ chối.
 */
export const ZNS_WORKER_OPTIONS = { concurrency: 5, limiter: { max: 10, duration: 1000 } };
/** Chỉ ghi DB, không gọi Zalo nên không cần limiter. */
export const INAPP_RETRY_WORKER_OPTIONS = { concurrency: 2 };

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
@Processor(QUEUE_NOTIFICATIONS, ZNS_WORKER_OPTIONS)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<ZnsSendJobData | InAppRetryJobData>, token?: string): Promise<'SENT' | void> {
    // Chỉ còn job xếp trước khi hàng riêng ra đời (còn nằm trong hàng này lúc deploy); job mới đi QUEUE_NOTIFICATIONS_INAPP_RETRY.
    if (job.name === INAPP_RETRY_JOB) return retryInApp(this.notifications, this.logger, job as Job<InAppRetryJobData>);
    return this.sendZns(job as Job<ZnsSendJobData>, token);
  }

  /**
   * BullMQ phát 'failed' cho cả lượt lỗi còn được thử lại; chỉ khi job không chạy lại nữa (hết lượt, hoặc stalled quá giới hạn)
   * mà log còn PENDING/RETRYING thì không ai ghi kết cục nữa. Không ném: lỗi ở đây không được làm sập worker; cron quét log kẹt là đường dự phòng.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ZnsSendJobData> | undefined, err: Error): Promise<void> {
    if (!job || job.name !== ZNS_SEND_JOB) return;
    const attempts = job.opts?.attempts ?? 1;
    // Chỉ cấu trúc mới cho biết BullMQ không chạy lại nữa; câu lỗi chỉ để chọn lời giải thích (lỗi DB/mạng có chữ "stalled" ở lượt chưa cuối vẫn được chạy lại).
    const unrecoverable = err instanceof UnrecoverableError || err?.name === 'UnrecoverableError';
    if (!unrecoverable && job.attemptsMade < attempts) return;
    const stalled = /stalled/i.test(err?.message ?? '');
    const logId = job.data?.notificationLogId;
    if (!logId) return;
    const why = stalled ? 'tác vụ gửi bị treo quá giới hạn của hàng đợi' : 'tác vụ gửi hỏng ở lượt cuối, không còn lượt thử lại';
    try {
      const closed = await this.notifications.closeStuckZnsLog(logId, `Gửi ZNS dừng: ${why}. Chi tiết kỹ thuật: ${oneLineReason(err?.message ?? err)}`);
      if (closed) this.logger.warn(`Đã đóng log ZNS ${logId} thành FAILED vì ${why}.`);
    } catch (closeErr) {
      this.logger.error(`Không đóng được log ZNS ${logId} sau khi job hỏng hẳn: ${closeErr instanceof Error ? closeErr.message : closeErr}`);
      captureServerError(closeErr);
    }
  }

  /** Trả 'SENT' làm returnvalue của job: dấu vết để ZnsStuckLogCron ghi nốt SENT khi markZnsSent đã nuốt lỗi ghi. */
  private async sendZns(job: Job<ZnsSendJobData>, token?: string): Promise<'SENT' | void> {
    // Lượt thử lại do BullMQ xếp theo backoff nên có thể rơi sau 21h dù lượt đầu đã được dời; dời tiếp tới hết giờ yên tĩnh.
    // moveToDelayed + DelayedError không tính là một lượt thử (attemptsMade giữ nguyên), và chạy trước deliverZns để log vẫn còn nguyên trạng thái.
    const quietMs = await this.notifications.quietDelayMs();
    if (quietMs > 0) {
      await job.moveToDelayed(Date.now() + quietMs, token);
      throw new DelayedError();
    }
    const attempts = job.opts.attempts ?? 1;
    const outcome = await this.notifications.deliverZns(job.data, job.attemptsMade + 1 >= attempts);
    if (outcome === 'SENT') return 'SENT';
    if (outcome === 'SKIPPED') {
      this.logger.warn(`Bỏ qua job ZNS đến muộn của notificationLog ${job.data.notificationLogId}: log đã đóng (khoá đã nhả để gửi lại, hoặc đã có tin cho cùng sự kiện).`);
      return;
    }
    if (outcome === 'FAILED') {
      this.logger.error(`Gửi ZNS THẤT BẠI cho notificationLog ${job.data.notificationLogId} (xem cột error)`);
      return;
    }
    throw new Error('Gửi ZNS thất bại tạm thời, chờ BullMQ thử lại');
  }
}

/** Tin trong app không dời theo giờ yên tĩnh ZNS. Chỉ bù tin trong app: tin đã lưu thì notify() dừng ở khoá, ZNS lỗi trước đó không gửi nốt. */
async function retryInApp(notifications: NotificationsService, logger: Logger, job: Job<InAppRetryJobData>): Promise<void> {
  const { userId, templateCode, data, dedupeKey, context } = job.data;
  try {
    await notifications.notify(userId, templateCode, data, { dedupeKey });
  } catch (err) {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade + 1 >= attempts) {
      logger.error(
        `Gửi tin ${templateCode} cho ${userId}${context ? ` (${context})` : ''} THẤT BẠI sau ${attempts} lượt: ${err instanceof Error ? err.message : String(err)}`,
      );
      captureServerError(err);
    }
    throw err;
  }
}

/** Worker của QUEUE_NOTIFICATIONS_INAPP_RETRY: tách khỏi worker ZNS để Zalo chậm hay limiter không chặn tin trong app. */
@Processor(QUEUE_NOTIFICATIONS_INAPP_RETRY, INAPP_RETRY_WORKER_OPTIONS)
export class InAppRetryProcessor extends WorkerHost {
  private readonly logger = new Logger(InAppRetryProcessor.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  process(job: Job<InAppRetryJobData>): Promise<void> {
    return retryInApp(this.notifications, this.logger, job);
  }
}
