import { ConsoleLogger } from '@nestjs/common';
import { noteCronError } from './track-cron';

/** Dòng đầu của thông điệp lỗi; không stack. Giá trị không phải chuỗi/Error chỉ ghi kiểu vì có thể là dữ liệu request. */
export function firstLogLine(message: unknown): string {
  if (message instanceof Error) return `${message.constructor?.name ?? 'Error'}: ${firstNonEmptyLine(message.message)}`;
  if (typeof message === 'string') return firstNonEmptyLine(message);
  return typeof message;
}

function firstNonEmptyLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
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
