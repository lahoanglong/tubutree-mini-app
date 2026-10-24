import 'reflect-metadata';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';
import { formatVnDateTime } from '../vn-time';

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
  /** Lý do bỏ qua (RUNNING, LOCKED, NOT_CONFIGURED, BUSY) khi outcome là SKIPPED. */
  skipReason?: string;
  /** Số lần hỏng liên tiếp trước khi báo admin; mặc định 1. */
  alertAfter?: number;
}

export interface TrackCronOptions {
  /** Cron chạy dày (30 phút một lần hoặc hơn): đặt 2 để một lần lỗi lẻ (mạng chập chờn) chưa báo. Job hiếm giữ mặc định 1. */
  alertAfter?: number;
  /** Lượt trước còn chạy quá ngần này mà lượt sau bị bỏ qua vì 'RUNNING' thì tính là treo. Mặc định 2 giờ. */
  hangAfterMs?: number;
}

const DEFAULT_HANG_AFTER_MS = 2 * 3_600_000;

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

// Các lần chạy đang dở trong tiến trình này (khoá = hàm đã bọc). Guard `this.running` là theo từng tiến trình nên treo cũng thấy được ở đây,
// không cần ghi DB lúc bắt đầu mỗi lần chạy.
const inFlight = new Map<object, Set<Date>>();

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
export function TrackCron(options: TrackCronOptions = {}): MethodDecorator {
  return (target, key, descriptor) => {
    const original = descriptor.value as unknown as (...args: unknown[]) => unknown;
    const fallbackName = `${target.constructor.name}.${String(key)}`;
    const wrapped = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const startedAt = new Date();
      const ctx: CronContext = { errors: 0 };
      let error: unknown;
      let failed = false;
      const mine = inFlight.get(wrapped) ?? new Set<Date>();
      mine.add(startedAt);
      inFlight.set(wrapped, mine);
      try {
        return await als.run(ctx, () => original.apply(this, args));
      } catch (err) {
        failed = true;
        error = err;
        throw err;
      } finally {
        mine.delete(startedAt);
        if (mine.size === 0) inFlight.delete(wrapped);
        await report(wrapped, fallbackName, startedAt, ctx, failed, error, options, mine);
      }
    };
    Object.defineProperty(wrapped, 'name', { value: String(key) });
    (descriptor as { value: unknown }).value = wrapped;
  };
}

async function report(
  fn: object,
  fallbackName: string,
  startedAt: Date,
  ctx: CronContext,
  failed: boolean,
  error: unknown,
  options: TrackCronOptions,
  others: Set<Date>,
): Promise<void> {
  if (!sink) return;
  try {
    const opts = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, fn) as { name?: string } | undefined;
    let outcome: CronOutcome = failed ? 'THREW' : ctx.errors > 0 ? 'ERRORS' : ctx.skipped !== undefined ? 'SKIPPED' : 'OK';
    let errorCount = ctx.errors;
    let errorLine = ctx.firstError;
    if (outcome === 'SKIPPED' && ctx.skipped === 'RUNNING') {
      // Lượt trước chưa xong mà đã quá lâu: mọi lượt sau sẽ bị bỏ qua mãi và không ai biết, nên tính là hỏng để đường báo động chạy.
      const oldest = [...others].reduce<Date | undefined>((a, d) => (!a || d < a ? d : a), undefined);
      if (oldest && startedAt.getTime() - oldest.getTime() > (options.hangAfterMs ?? DEFAULT_HANG_AFTER_MS)) {
        outcome = 'ERRORS';
        errorCount = 1;
        errorLine = `Đang chạy treo từ ${formatVnDateTime(oldest)}`;
      }
    }
    await sink.record({
      job: opts?.name || fallbackName,
      startedAt,
      finishedAt: new Date(),
      outcome,
      errorCount,
      ...(outcome === 'SKIPPED' && ctx.skipped !== undefined ? { skipReason: ctx.skipped } : {}),
      ...(errorLine !== undefined ? { errorLine: errorLine.slice(0, 300) } : {}),
      ...(failed ? { error } : {}),
      ...(options.alertAfter !== undefined ? { alertAfter: options.alertAfter } : {}),
    });
  } catch (err) {
    logger.error(`Không ghi nhận được lần chạy cron ${fallbackName}: ${err instanceof Error ? err.message : err}`);
  }
}
