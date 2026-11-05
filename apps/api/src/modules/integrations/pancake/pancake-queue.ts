import type { Queue } from 'bullmq';
import { withQueueTimeout } from '../../../jobs/queue-timeout';

/**
 * Job của queue pancake-push (outbound) — gọi được từ module không import PancakeModule (orders, payment) qua
 * @InjectQueue(QUEUE_PANCAKE_PUSH) (QueueModule @Global), tránh vòng phụ thuộc module.
 *  - push: tạo đơn Pancake (có claim + tra theo mã đơn trước khi tạo lại, xem PancakeOrderService.pushOrder);
 *  - payment: đơn đã trả tiền sau khi lên Pancake → cập nhật "đã thanh toán, không thu COD";
 *  - cancel: đơn huỷ ở Tubu → huỷ đơn Pancake (chưa bàn giao vận chuyển).
 */
export const PANCAKE_JOB_PUSH = 'push';
export const PANCAKE_JOB_PAYMENT = 'payment';
export const PANCAKE_JOB_CANCEL = 'cancel';

/** jobId KHÔNG được chứa ':' (BullMQ 5). */
export const pancakePushJobId = (orderId: string) => orderId;
export const pancakePaymentJobId = (orderId: string) => `payment-${orderId}`;
export const pancakeCancelJobId = (orderId: string) => `cancel-${orderId}`;

/**
 * Xoá job cùng jobId đã KẾT THÚC (completed/failed) rồi add lại: BullMQ giữ hash job đã xong (removeOnComplete /
 * removeOnFail 1000) và bỏ qua lệnh add trùng jobId — cron cứu hộ sẽ "re-enqueue" mãi mà không có gì chạy (đơn đặt
 * lúc Pancake chưa cấu hình kẹt vĩnh viễn). Xoá cả job completed là AN TOÀN vì mọi handler đều idempotent theo DB:
 * push có claim và tra Pancake theo mã đơn trước khi tạo lại; payment/cancel bỏ qua khi trạng thái đã chốt.
 * Job đang waiting/active/delayed thì giữ nguyên — BullMQ tự dedupe.
 */
export function addPancakeJob(queue: Queue, name: string, orderId: string, jobId: string): Promise<void> {
  return withQueueTimeout(replaceFinishedAndAdd(queue, name, orderId, jobId), `${queue.name} ${jobId}`);
}

async function replaceFinishedAndAdd(queue: Queue, name: string, orderId: string, jobId: string): Promise<void> {
  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') await existing.remove();
    }
  } catch {
    /* không đọc được trạng thái job → cứ add, BullMQ tự dedupe */
  }
  await queue.add(name, { orderId }, { jobId });
}

export function enqueuePancakePush(queue: Queue, orderId: string): Promise<void> {
  return addPancakeJob(queue, PANCAKE_JOB_PUSH, orderId, pancakePushJobId(orderId));
}

export function enqueuePancakePayment(queue: Queue, orderId: string): Promise<void> {
  return addPancakeJob(queue, PANCAKE_JOB_PAYMENT, orderId, pancakePaymentJobId(orderId));
}

export function enqueuePancakeCancel(queue: Queue, orderId: string): Promise<void> {
  return addPancakeJob(queue, PANCAKE_JOB_CANCEL, orderId, pancakeCancelJobId(orderId));
}

/**
 * Gỡ job push ĐÃ LỖI của đơn: việc đã có kết cục (lên Pancake, huỷ, người đã xử lý) thì dấu lỗi trong tập failed chỉ còn gây
 * nhiễu (go-live, bảng hàng đợi). Job đang chờ/chạy/hoãn giữ nguyên. Lỗi Redis chỉ ghi nhận, không làm hỏng việc đang làm:
 * quét định kỳ (sweepSettledFailedJobs) và hạn tuổi removeOnFail dọn nốt phần sót.
 */
export async function removeFailedPancakePush(queue: Queue, orderId: string): Promise<boolean> {
  try {
    return await withQueueTimeout(removeIfFailed(queue, pancakePushJobId(orderId)), `${queue.name} gỡ job lỗi ${orderId}`);
  } catch {
    return false;
  }
}

async function removeIfFailed(queue: Queue, jobId: string): Promise<boolean> {
  const job = await queue.getJob(jobId);
  if (!job || (await job.getState()) !== 'failed') return false;
  await job.remove();
  return true;
}
