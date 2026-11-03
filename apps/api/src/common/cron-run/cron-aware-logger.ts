import { ConsoleLogger } from '@nestjs/common';
import { noteCronError } from './track-cron';

/** Dòng đầu của thông điệp lỗi; không stack. Giá trị không phải chuỗi/Error chỉ ghi kiểu vì có thể là dữ liệu request. */
export function firstLogLine(message: unknown): string {
  if (message instanceof Error) return `${message.constructor?.name ?? 'Error'}: ${firstNonEmptyLine(message.message)}`;
  if (typeof message === 'string') return firstNonEmptyLine(message);
  return typeof message;
}

// Lỗi Prisma mở đầu bằng "Invalid `prisma.x()` invocation:" (ở dev kèm đường dẫn và khung mã); câu lỗi thật là dòng cuối của message.
const PRISMA_INVOCATION = /^Invalid `[^`]+` invocation\b/;

/** Dòng đầu không rỗng; với lỗi Prisma thì nối phần trước dòng "Invalid ... invocation" với câu lỗi thật, bỏ stack. */
export function firstNonEmptyLine(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const at = lines.findIndex((l) => PRISMA_INVOCATION.test(l));
  if (at < 0) return lines[0] ?? '';
  const stack = lines.findIndex((l, i) => i > at && l.startsWith('at '));
  const last = (stack < 0 ? lines.length : stack) - 1;
  return [...lines.slice(0, at), lines[last]!].join(' ');
}

/**
 * Logger của app: y hệt ConsoleLogger, chỉ thêm việc đếm log mức error khi đang trong một lần chạy @TrackCron().
 * Phần lớn cron tự bắt lỗi và chỉ log; không đếm thì màn Sức khoẻ sẽ báo "thành công" khi đang hỏng.
 */
export class CronAwareLogger extends ConsoleLogger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override error(message: any, ...optionalParams: any[]): void {
    noteCronError(firstLogLine(message));
    super.error(message, ...optionalParams);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override fatal(message: any, ...optionalParams: any[]): void {
    noteCronError(firstLogLine(message));
    super.fatal(message, ...optionalParams);
  }
}
