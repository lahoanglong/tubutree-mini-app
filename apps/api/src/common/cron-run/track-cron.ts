import 'reflect-metadata';
import { Logger } from '@nestjs/common';

export interface CronRunReport {
  job: string;
  startedAt: Date;
  finishedAt: Date;
  /** Có = lần chạy này ném lỗi. */
  error?: unknown;
}

export interface CronRunSink {
  record(run: CronRunReport): Promise<void> | void;
}

let sink: CronRunSink | undefined;

/** CronRunService tự đăng ký lúc khởi tạo; không có sink (test đơn vị dựng service trực tiếp) thì @TrackCron() không làm gì thêm. */
export function setCronRunSink(next: CronRunSink | undefined): void {
  sink = next;
}

const logger = new Logger('TrackCron');
// Cùng khoá mà @Cron() của @nestjs/schedule ghi lên hàm; đọc lúc chạy (không phải lúc khai báo) vì @Cron nằm trên @TrackCron().
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

/**
 * Đặt NGAY DƯỚI @Cron(...). Không thể ghi nhận ở một chỗ trung tâm (SchedulerRegistry): ScheduleExplorer đã bọc
 * mỗi handler trong try/catch nuốt lỗi, và `cron` bỏ promise của callback, nên từ bên ngoài không thấy lỗi nào.
 * Test track-cron.spec.ts chạy @Cron thật và bắt buộc mọi @Cron trong src đều kèm decorator này.
 */
export function TrackCron(): MethodDecorator {
  return (target, key, descriptor) => {
    const original = descriptor.value as unknown as (...args: unknown[]) => unknown;
    const fallbackName = `${target.constructor.name}.${String(key)}`;
    const wrapped = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const startedAt = new Date();
      let error: unknown;
      let failed = false;
      try {
        return await original.apply(this, args);
      } catch (err) {
        failed = true;
        error = err;
        throw err;
      } finally {
        await report(wrapped, fallbackName, startedAt, failed, error);
      }
    };
    Object.defineProperty(wrapped, 'name', { value: String(key) });
    (descriptor as { value: unknown }).value = wrapped;
  };
}

async function report(fn: object, fallbackName: string, startedAt: Date, failed: boolean, error: unknown): Promise<void> {
  if (!sink) return;
  try {
    const opts = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, fn) as { name?: string } | undefined;
    await sink.record({ job: opts?.name || fallbackName, startedAt, finishedAt: new Date(), ...(failed ? { error } : {}) });
  } catch (err) {
    logger.error(`Không ghi nhận được lần chạy cron ${fallbackName}: ${err instanceof Error ? err.message : err}`);
  }
}
