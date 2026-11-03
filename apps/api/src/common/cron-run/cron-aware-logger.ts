import { ConsoleLogger } from '@nestjs/common';
import { noteCronError } from './track-cron';

/** Dòng đầu của thông điệp lỗi; không stack. Giá trị không phải chuỗi/Error chỉ ghi kiểu vì có thể là dữ liệu request. */
export function firstLogLine(message: unknown): string {
  if (message instanceof Error) return `${message.constructor?.name ?? 'Error'}: ${firstNonEmptyLine(message.message)}`;
  if (typeof message === 'string') return firstNonEmptyLine(message);
  return typeof message;
}

// Lỗi Prisma mở đầu bằng "Invalid `prisma.x()` invocation:"; tiếp theo có thể là đoạn khung mã ("12 ..." / "→ 12 ...", ở dev)
// hoặc đoạn cây tham số ("{", ở production). Câu lỗi thật là dòng đầu của đoạn kế tiếp (các đoạn cách nhau bằng dòng trống).
const PRISMA_INVOCATION = /^Invalid `[^`]+` invocation\b/;
const NOT_MESSAGE_BLOCK = /^((→\s*)?\d+(\s|$)|[{}])/;
// Postgres in giá trị của dòng/khoá vi phạm (SĐT, tên, zaloId...) sau các cụm này, và giá trị đầu vào sai kiểu sau `: "`;
// dòng lỗi được lưu ở cron_runs và gửi admin nên cắt bỏ.
const ROW_VALUES = /(DETAIL:|Failing row contains|Key \(|detail: Some\(|: ").*$/;
// Lỗi ORM chỉ còn "Error occurred during query execution:"; mã SQLSTATE nằm trong dòng ConnectorError phía sau.
const SQLSTATE = /\bcode: "([0-9A-Z]{5})"/;

/** Dòng đầu không rỗng, bỏ stack; lỗi Prisma thì lấy câu lỗi thật thay cho dòng "Invalid ... invocation". Cắt giá trị dòng/khoá. */
export function firstNonEmptyLine(text: string): string {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.split('\n').map((l) => l.trim()).filter((l) => l !== ''))
    .filter((b) => b.length > 0);
  const first = blocks[0]?.[0] ?? '';
  const at = blocks.findIndex((b) => b.some((l) => PRISMA_INVOCATION.test(l)));
  let line = first;
  if (at >= 0) {
    const block = blocks.slice(at + 1).find((b) => !NOT_MESSAGE_BLOCK.test(b[0]!));
    let detail = block?.[0];
    const code = detail?.endsWith('during query execution:') ? block!.join(' ').match(SQLSTATE)?.[1] : undefined;
    if (code) detail = `${detail} ${code}`;
    if (detail !== undefined) line = PRISMA_INVOCATION.test(first) ? detail : `${first} ${detail}`;
  }
  return line.replace(ROW_VALUES, '…');
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
