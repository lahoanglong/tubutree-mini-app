import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { GomdonOrderService } from './gomdon-order.service';
import { GomdonWastePickupService } from './gomdon-waste-pickup.service';
import { QUEUE_GOMDON_PUSH } from '../../../jobs/queues';
import { GOMDON_JOB_CANCEL, GOMDON_JOB_WASTE_CANCEL, GOMDON_JOB_WASTE_PUSH } from './gomdon-queue';
import { GomdonRejectedError } from './gomdon.errors';

/** Gomdon từ chối DỨT KHOÁT (lỗi dữ liệu): thử chừng này lần là đủ, không chờ hết cửa sổ thử lại dài. */
export const GOMDON_PERMANENT_REJECT_ATTEMPTS = 3;

/**
 * Worker queue gomdon-push (outbound). Retry theo GOMDON_OUTBOUND_JOB_OPTIONS (gomdon-queue.ts).
 *  - job 'push': tạo vận đơn. Hết lượt retry mà Gomdon vẫn từ chối → fail-safe markFinalPushFailure: lỗi tạm
 *    còn trong cửa sổ thì để cron thử tiếp; còn lại FAILED (hoặc NEEDS_MANUAL_CHECK nếu không rõ đã tạo chưa)
 *    + VẪN đẩy Pancake với ghi chú cảnh báo + báo CSKH. Lỗi dữ liệu dứt khoát chốt sớm sau vài lần.
 *    Nếu chính fail-safe lỗi (DB down) → ném tiếp để job kết thúc 'failed' (trước đây nuốt lỗi và
 *    'completed' → cron re-enqueue cùng jobId bị BullMQ bỏ qua, đơn kẹt vĩnh viễn không tới kho).
 *  - job 'cancel': huỷ vận đơn của đơn đã huỷ; lần thử cuối lỗi → CANCEL FAILED + báo CSKH.
 *  - job 'waste-push' / 'waste-cancel': vận đơn của phiếu shipper lấy rác tận nhà (WasteRequest HOME_PICKUP). Hết lượt tạo mà Gomdon vẫn từ chối
 *    thì tự huỷ phiếu + hoàn Điểm Xanh phí ship (GomdonWastePickupService.markFinalPushFailure), không có đơn Pancake nào để đẩy.
 */
@Processor(QUEUE_GOMDON_PUSH)
export class GomdonPushProcessor extends WorkerHost {
  private readonly logger = new Logger(GomdonPushProcessor.name);

  constructor(
    private readonly gomdonOrder: GomdonOrderService,
    private readonly gomdonWaste: GomdonWastePickupService,
  ) {
    super();
  }

  async process(job: Job<{ orderId?: string; requestId?: string }>): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= attempts;

    if (job.name === GOMDON_JOB_WASTE_PUSH || job.name === GOMDON_JOB_WASTE_CANCEL) {
      await this.processWaste(job as Job<{ requestId: string }>, isLastAttempt);
      return;
    }
    const orderId = job.data.orderId as string;

    if (job.name === GOMDON_JOB_CANCEL) {
      await this.gomdonOrder.cancelOnGomdon(orderId, isLastAttempt);
      return;
    }

    try {
      await this.gomdonOrder.pushOrder(orderId);
    } catch (err) {
      // Đã tạo vận đơn mà không ghi được DB / không ghi được NEEDS_MANUAL_CHECK: KHÔNG retry, KHÔNG
      // fail-safe "tạo tay" (có thể đã có vận đơn thật) — để job failed, cron cứu hộ xử lý CREATING kẹt.
      if (err instanceof UnrecoverableError) throw err;
      const permanentGiveUp =
        err instanceof GomdonRejectedError && !err.transient && job.attemptsMade + 1 >= GOMDON_PERMANENT_REJECT_ATTEMPTS;
      if (!isLastAttempt && !permanentGiveUp) throw err; // BullMQ retry

      this.logger.error(
        `Tạo đơn Gomdon THẤT BẠI sau ${job.attemptsMade + 1} lần cho đơn ${orderId}: ${
          err instanceof Error ? err.message : err
        }. Kích hoạt fail-safe: đẩy Pancake với cảnh báo + báo CSKH.`,
      );
      await this.gomdonOrder.markFinalPushFailure(orderId, err);
    }
  }

  private async processWaste(job: Job<{ requestId: string }>, isLastAttempt: boolean): Promise<void> {
    const { requestId } = job.data;
    if (job.name === GOMDON_JOB_WASTE_CANCEL) {
      await this.gomdonWaste.cancelOnGomdon(requestId, isLastAttempt);
      return;
    }
    try {
      await this.gomdonWaste.pushRequest(requestId);
    } catch (err) {
      // Đã tạo vận đơn mà không ghi được DB: KHÔNG retry, KHÔNG huỷ phiếu (có thể đã có vận đơn thật) — để job failed, cron cứu hộ xử lý CREATING kẹt.
      if (err instanceof UnrecoverableError) throw err;
      const permanentGiveUp = err instanceof GomdonRejectedError && !err.transient && job.attemptsMade + 1 >= GOMDON_PERMANENT_REJECT_ATTEMPTS;
      if (!isLastAttempt && !permanentGiveUp) throw err; // BullMQ retry

      this.logger.error(
        `Tạo vận đơn Gomdon THẤT BẠI sau ${job.attemptsMade + 1} lần cho phiếu thu gom ${requestId}: ${err instanceof Error ? err.message : err}. Huỷ phiếu và hoàn Điểm Xanh phí ship.`,
      );
      await this.gomdonWaste.markFinalPushFailure(requestId, err);
    }
  }
}
