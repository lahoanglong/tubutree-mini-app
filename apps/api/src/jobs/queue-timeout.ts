/**
 * Hạn chờ cho một lệnh BullMQ trên đường request (checkout, webhook, health).
 *
 * Khi Redis mất kết nối, BullMQ để retryStrategy của ioredis thử lại không giới hạn và giữ lệnh
 * trong offline queue (maxRetriesPerRequest=null bắt buộc cho Worker). Lúc đó queue.add/getJob
 * không resolve cũng không reject, nên try/catch quanh nó không bao giờ chạy và request treo tới
 * khi client tự huỷ. Chặn bằng một hạn ngắn: quá hạn thì ném lỗi để caller rơi về cron reconcile
 * như thiết kế. Lệnh gốc vẫn có thể chạy khi Redis lên lại; mọi job đều có jobId cố định nên
 * BullMQ tự chặn trùng.
 */
export const QUEUE_COMMAND_TIMEOUT_MS = 2000;

export class QueueTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`Redis không phản hồi sau ${ms}ms (${label})`);
    this.name = 'QueueTimeoutError';
  }
}

export function withQueueTimeout<T>(command: Promise<T>, label: string, ms = QUEUE_COMMAND_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueTimeoutError(label, ms)), ms);
  });
  command.catch(() => undefined);
  return Promise.race([command, timeout]).finally(() => clearTimeout(timer));
}
