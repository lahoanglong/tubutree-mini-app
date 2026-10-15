import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { PancakeOrderService } from './pancake-order.service';
import { QUEUE_PANCAKE_PUSH } from '../../../jobs/queues';
import { PANCAKE_JOB_CANCEL, PANCAKE_JOB_PAYMENT } from './pancake-queue';
import { PancakeApiError, PancakeCancelRefusedError, PancakeOrderDataError, pancakeErrorText } from './pancake-outbound';

/**
 * Worker queue pancake-push (outbound). Retry+backoff (5 lần, exponential 2s) do BullMQ tự quản qua
 * defaultJobOptions (jobs/queue.module.ts). Ném lỗi tiếp để BullMQ đếm attempt.
 *  - push: tạo đơn. Mỗi lần lỗi ghi lý do lên đơn (admin thấy); lần cuối chốt FAILED + "Cần xử lý Pancake" (lỗi tạm
 *    của đơn mới thì chưa — xem PancakeOrderService.PUSH_ATTENTION_GRACE_MINUTES). Thiếu dữ liệu người nhận hay Pancake
 *    từ chối dứt khoát (4xx) thì dừng ngay (thử lại không giúp gì); cron cứu hộ vẫn thử lại thưa dần.
 *  - payment / cancel: cập nhật "đã thanh toán" / huỷ đơn Pancake; lần cuối báo admin xử lý tay (Pancake từ chối lệnh huỷ
 *    thì chốt và báo ngay lượt đầu).
 */
@Processor(QUEUE_PANCAKE_PUSH)
export class PancakePushProcessor extends WorkerHost {
  private readonly logger = new Logger(PancakePushProcessor.name);

  constructor(private readonly pancakeOrder: PancakeOrderService) {
    super();
  }

  async process(job: Job<{ orderId: string }>): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    const final = job.attemptsMade + 1 >= attempts;
    const { orderId } = job.data;

    if (job.name === PANCAKE_JOB_CANCEL) {
      try {
        await this.pancakeOrder.cancelOnPancake(orderId, final);
      } catch (err) {
        // Đã ghi FAILED + báo huỷ tay ngay lượt này: BullMQ thử lại 4 lần nữa cũng nhận cùng lời từ chối.
        if (err instanceof PancakeCancelRefusedError) throw new UnrecoverableError(pancakeErrorText(err));
        throw err;
      }
      return;
    }
    if (job.name === PANCAKE_JOB_PAYMENT) {
      await this.pancakeOrder.syncPayment(orderId, final);
      return;
    }

    try {
      await this.pancakeOrder.pushOrder(orderId);
    } catch (err) {
      // Thiếu dữ liệu người nhận, hay Pancake từ chối dứt khoát (4xx, không phải mất kết nối/5xx/429): thử lại ngay không giúp gì.
      const unrecoverable = err instanceof PancakeOrderDataError || (err instanceof PancakeApiError && !err.transient);
      if (final || unrecoverable) {
        this.logger.error(`Đẩy Pancake THẤT BẠI (lần ${job.attemptsMade + 1}) cho đơn ${orderId}: ${pancakeErrorText(err)}`);
      }
      await this.pancakeOrder
        .markPushFailure(orderId, err, final || unrecoverable)
        .catch((e) => this.logger.error(`Không ghi được lỗi đẩy Pancake cho đơn ${orderId}: ${pancakeErrorText(e)}`));
      if (unrecoverable) throw new UnrecoverableError(pancakeErrorText(err));
      throw err;
    }
  }
}
