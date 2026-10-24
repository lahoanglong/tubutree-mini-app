import 'reflect-metadata';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';

/**
 * THREW: phương thức ném lỗi. ERRORS: chạy xong nhưng ghi ít nhất một log mức error (cron tự bắt lỗi rồi chỉ log).
 * SKIPPED: thoát sớm vì đang chạy chồng / chưa cấu hình (markCronSkipped). OK: còn lại.
 */
export type CronOutcome = 'OK' | 'ERRORS' | 'THREW' | 'SKIPPED';

export interface CronRunReport {
  job: string;
  startedAt: Date;
  finishedAt: Date;
  outcome: CronOutcome;
  /** Số log mức error trong lúc chạy. */
  errorCount: number;
  /** Dòng đầu của log error đầu tiên (ERRORS). */
  errorLine?: string;
  /** Lỗi gốc khi THREW. */
  error?: unknown;
}

export interface CronRunSink {
  record(run: CronRunReport): Promise<void> | void;
}

interface CronContext {
  errors: number;
  firstError?: string;
  skipped?: string;
}

const als = new AsyncLocalStorage<CronContext>();

/** CronAwareLogger gọi khi có log error; ngoài một lần chạy @TrackCron() thì không làm gì. */
export function noteCronError(line: string): void {
  const ctx = als.getStore();
  if (!ctx) return;
  ctx.errors++;
  ctx.firstError ??= line;
}

/** Đặt ở chỗ thoát sớm của cron (đang chạy chồng, chưa cấu hình): lần chạy đó không tính là thành công hay thất bại. */
export function markCronSkipped(reason: string): void {
  const ctx = als.getStore();
  if (ctx) ctx.skipped = reason;
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
      const ctx: CronContext = { errors: 0 };
      let error: unknown;
      let failed = false;
      try {
        return await als.run(ctx, () => original.apply(this, args));
      } catch (err) {
        failed = true;
        error = err;
        throw err;
      } finally {
        await report(wrapped, fallbackName, startedAt, ctx, failed, error);
      }
    };
    Object.defineProperty(wrapped, 'name', { value: String(key) });
    (descriptor as { value: unknown }).value = wrapped;
  };
}

async function report(fn: object, fallbackName: string, startedAt: Date, ctx: CronContext, failed: boolean, error: unknown): Promise<void> {
  if (!sink) return;
  try {
    const opts = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, fn) as { name?: string } | undefined;
    const outcome: CronOutcome = failed ? 'THREW' : ctx.errors > 0 ? 'ERRORS' : ctx.skipped !== undefined ? 'SKIPPED' : 'OK';
    await sink.record({
      job: opts?.name || fallbackName,
      startedAt,
      finishedAt: new Date(),
      outcome,
      errorCount: ctx.errors,
      ...(ctx.firstError !== undefined ? { errorLine: ctx.firstError.slice(0, 300) } : {}),
      ...(failed ? { error } : {}),
    });
  } catch (err) {
    logger.error(`Không ghi nhận được lần chạy cron ${fallbackName}: ${err instanceof Error ? err.message : err}`);
  }
}
