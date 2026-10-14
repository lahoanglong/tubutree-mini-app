import type { JobsOptions, Queue } from 'bullmq';
import { withQueueTimeout } from '../../../jobs/queue-timeout';

/**
 * Helper enqueue dùng chung cho queue gomdon-push — gọi được từ module KHÔNG import GomdonModule
 * (orders, payment, pancake) qua @InjectQueue(QUEUE_GOMDON_PUSH) (QueueModule @Global), tránh vòng
 * phụ thuộc module.
 */
export const GOMDON_JOB_PUSH = 'push';
export const GOMDON_JOB_CANCEL = 'cancel';
export const GOMDON_JOB_EVENT = 'process';

/**
 * Retry riêng cho job GỌI Gomdon (tạo/huỷ vận đơn): 8 lần, backoff mũ từ 5 giây ≈ 10 phút. Mặc định chung của
 * QueueModule (5 lần từ 2 giây ≈ 30 giây) làm một lần Gomdon chập chờn nửa phút biến mọi đơn thu gom trong
 * khoảng đó thành "tạo vận đơn tay". Lỗi tạm kéo dài hơn nữa do cron cứu hộ thử tiếp trong cửa sổ
 * (GomdonOrderService.TRANSIENT_PUSH_WINDOW_MS, GomdonReconcileService.CANCEL_RETRY_WINDOW_HOURS).
 */
export const GOMDON_OUTBOUND_JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 5_000 },
} as const satisfies JobsOptions;

/** jobId KHÔNG được chứa ':' (BullMQ 5 ném "Custom Id cannot contain :"). */
export const gomdonPushJobId = (orderId: string) => orderId;
export const gomdonCancelJobId = (orderId: string) => `cancel-${orderId}`;

/**
 * Xoá job cũ cùng jobId nếu nó đã KẾT THÚC (completed/failed) rồi add lại.
 *
 * BullMQ giữ hash job sau khi xong (removeOnComplete 1000 / removeOnFail 1000 — jobs/queue.module.ts)
 * và addStandardJob thấy jobId còn tồn tại là KHÔNG enqueue — cron cứu hộ sẽ log "re-enqueue" mãi mà
 * không có gì chạy. Khác pancake-push (chỉ xoá job failed vì pushOrder Pancake không có claim), ở đây
 * xoá cả job completed là AN TOÀN vì mọi handler Gomdon đều idempotent:
 *  - push: claim nguyên tử gomdonStatus → CREATING trước khi gọi API, thấy CREATING thì không tạo lại;
 *  - cancel: bỏ qua khi gomdonCancelStatus đã chốt;
 *  - event: bỏ qua event đã PROCESSED/IGNORED.
 * Job đang waiting/active/delayed thì giữ nguyên — BullMQ tự dedupe.
 */
export function addGomdonJob(
  queue: Queue,
  name: string,
  data: object,
  jobId: string,
  opts: Omit<JobsOptions, 'jobId'> = {},
): Promise<void> {
  return withQueueTimeout(replaceFinishedAndAdd(queue, name, data, jobId, opts), `${queue.name} ${jobId}`);
}

async function replaceFinishedAndAdd(
  queue: Queue,
  name: string,
  data: object,
  jobId: string,
  opts: Omit<JobsOptions, 'jobId'>,
): Promise<void> {
  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') await existing.remove();
    }
  } catch {
    /* không đọc được trạng thái job → cứ add, BullMQ tự dedupe */
  }
  await queue.add(name, data, { ...opts, jobId });
}

export function enqueueGomdonPush(queue: Queue, orderId: string): Promise<void> {
  return addGomdonJob(queue, GOMDON_JOB_PUSH, { orderId }, gomdonPushJobId(orderId), GOMDON_OUTBOUND_JOB_OPTIONS);
}

export function enqueueGomdonCancel(queue: Queue, orderId: string): Promise<void> {
  return addGomdonJob(queue, GOMDON_JOB_CANCEL, { orderId }, gomdonCancelJobId(orderId), GOMDON_OUTBOUND_JOB_OPTIONS);
}
