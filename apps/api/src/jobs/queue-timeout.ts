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

/**
 * Breaker: Redis sập thì mỗi lệnh đều chờ đủ 2 giây rồi mới lỗi, nên mọi request có notify/enqueue chậm thêm 2 giây một lần.
 * QUEUE_BREAKER_THRESHOLD lần quá hạn liên tiếp thì mở QUEUE_BREAKER_OPEN_MS: trong lúc mở, lệnh lỗi ngay (caller đi đường dự phòng
 * sẵn có: ghi log, rơi về cron reconcile). Hết hạn mở thì cho đúng một lệnh dò; dò xong thì đóng, dò hỏng thì mở lại ngay.
 * Trạng thái theo từng tiến trình (mỗi replica tự phát hiện) và dùng chung cho mọi hàng đợi vì chỉ có một Redis. Chỉ quá hạn mới
 * tính: lệnh bị Redis trả lỗi nghĩa là Redis còn trả lời.
 * Giới hạn: lệnh gốc đã được caller gọi trước khi vào đây nên vẫn nằm trong offline queue của ioredis; breaker chỉ cắt thời gian chờ.
 */
export const QUEUE_BREAKER_THRESHOLD = 3;
export const QUEUE_BREAKER_OPEN_MS = 30_000;

export class QueueBreakerOpenError extends QueueTimeoutError {
  constructor(label: string) {
    super(label, 0);
    this.message = `Redis tạm ngắt do lỗi liên tiếp, bỏ qua lệnh (${label})`;
    this.name = 'QueueBreakerOpenError';
  }
}

function withPlainTimeout<T>(command: Promise<T>, label: string, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueTimeoutError(label, ms)), ms);
  });
  command.catch(() => undefined);
  return Promise.race([command, timeout])
    .then((value) => {
      // Redis trả lời được: đóng breaker để enqueue thường không còn bị chặn trong khi /health báo Redis đã lên. Lỗi/quá hạn của lời gọi này không đếm.
      breakerFailures = 0;
      breakerOpenUntil = 0;
      return value;
    })
    .finally(() => clearTimeout(timer));
}

let breakerFailures = 0;
let breakerOpenUntil = 0;
let breakerProbing = false;

export function resetQueueBreaker(): void {
  breakerFailures = 0;
  breakerOpenUntil = 0;
  breakerProbing = false;
}

/**
 * `breaker: false` cho lời gọi sức khoẻ (quét 9 hàng đợi, ping): lô nặng hoặc event loop bận có thể quá hạn khi Redis vẫn khoẻ, và
 * lúc breaker mở chính lời gọi này phải chạy thật để báo Redis đã lên lại. Không bị chặn và lỗi/quá hạn không đếm; thành công thì đóng breaker.
 */
export function withQueueTimeout<T>(command: Promise<T>, label: string, ms = QUEUE_COMMAND_TIMEOUT_MS, opts: { breaker?: boolean } = {}): Promise<T> {
  if (opts.breaker === false) return withPlainTimeout(command, label, ms);
  let probe = false;
  if (breakerFailures >= QUEUE_BREAKER_THRESHOLD) {
    command.catch(() => undefined);
    if (Date.now() < breakerOpenUntil || breakerProbing) return Promise.reject(new QueueBreakerOpenError(label));
    breakerProbing = true;
    probe = true;
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueTimeoutError(label, ms)), ms);
  });
  command.catch(() => undefined);
  return Promise.race([command, timeout])
    .then(
      (value) => {
        breakerFailures = 0;
        return value;
      },
      (err: unknown) => {
        if (err instanceof QueueTimeoutError) {
          breakerFailures += 1;
          if (breakerFailures >= QUEUE_BREAKER_THRESHOLD) breakerOpenUntil = Date.now() + QUEUE_BREAKER_OPEN_MS;
        } else {
          breakerFailures = 0;
        }
        throw err;
      },
    )
    .finally(() => {
      clearTimeout(timer);
      if (probe) breakerProbing = false;
    });
}
