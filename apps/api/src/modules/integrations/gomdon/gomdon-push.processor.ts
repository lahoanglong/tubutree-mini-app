import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { GomdonOrderService } from './gomdon-order.service';
import { QUEUE_GOMDON_PUSH } from '../../../jobs/queues';
import { GOMDON_JOB_CANCEL } from './gomdon-queue';

/**
 * Worker queue gomdon-push (outbound). Retry 5 lần (defaultJobOptions BullMQ).
 *  - job 'push': tạo vận đơn. Hết lượt retry mà Gomdon vẫn từ chối → fail-safe: FAILED (hoặc
 *    NEEDS_MANUAL_CHECK nếu không rõ đã tạo chưa) + VẪN đẩy Pancake với ghi chú cảnh báo + báo CSKH.
 *    Nếu chính fail-safe lỗi (DB down) → ném tiếp để job kết thúc 'failed' (trước đây nuốt lỗi và
 *    'completed' → cron re-enqueue cùng jobId bị BullMQ bỏ qua, đơn kẹt vĩnh viễn không tới kho).
 *  - job 'cancel': huỷ vận đơn của đơn đã huỷ; lần thử cuối lỗi → CANCEL FAILED + báo CSKH.
 */
@Processor(QUEUE_GOMDON_PUSH)
export class GomdonPushProcessor extends WorkerHost {
  private readonly logger = new Logger(GomdonPushProcessor.name);

  constructor(private readonly gomdonOrder: GomdonOrderService) {
    super();
  }

  async process(job: Job<{ orderId: string }>): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= attempts;

    if (job.name === GOMDON_JOB_CANCEL) {
      await this.gomdonOrder.cancelOnGomdon(job.data.orderId, isLastAttempt);
      return;
    }

    try {
      await this.gomdonOrder.pushOrder(job.data.orderId);
    } catch (err) {
      // Đã tạo vận đơn mà không ghi được DB / không ghi được NEEDS_MANUAL_CHECK: KHÔNG retry, KHÔNG
      // fail-safe "tạo tay" (có thể đã có vận đơn thật) — để job failed, cron cứu hộ xử lý CREATING kẹt.
      if (err instanceof UnrecoverableError) throw err;
      if (!isLastAttempt) throw err; // BullMQ retry

      this.logger.error(
        `Tạo đơn Gomdon THẤT BẠI sau ${attempts} lần cho đơn ${job.data.orderId}: ${
          err instanceof Error ? err.message : err
        }. Kích hoạt fail-safe: đẩy Pancake với cảnh báo + báo CSKH.`,
      );
      await this.gomdonOrder.markFinalPushFailure(job.data.orderId, err);
    }
  }
}
