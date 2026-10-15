import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { NotificationsService, ZnsSendJobData } from './notifications.service';
import { QUEUE_NOTIFICATIONS } from '../../jobs/queues';

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

  async process(job: Job<ZnsSendJobData>): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    const outcome = await this.notifications.deliverZns(job.data, job.attemptsMade + 1 >= attempts);
    if (outcome === 'SENT') return;
    if (outcome === 'FAILED') {
      this.logger.error(`Gửi ZNS THẤT BẠI cho notificationLog ${job.data.notificationLogId} (xem cột error)`);
      return;
    }
    throw new Error('Gửi ZNS thất bại tạm thời, chờ BullMQ thử lại');
  }
}
