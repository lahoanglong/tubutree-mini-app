import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const LOCK_BUSY_MESSAGE = 'Hệ thống đang bận, bạn thử lại sau ít giây nhé.';

// Lỗi nghiệp vụ (HttpException) có thể chứa chuỗi như "40001" trong tên sản phẩm; không bao giờ là lỗi khoá.
/**
 * Thua tranh khoá, thử lại là qua: hạn chờ khoá/câu lệnh/tx (55P03 lock_timeout, 57014 statement_timeout, P2028 Prisma huỷ tx)
 * hoặc bị Postgres chọn làm nạn nhân deadlock (40P01, Prisma P2034). Câu raw ném lỗi Postgres trong message (P2010) nên dò cả
 * mã SQLSTATE trong đó.
 */
export function isLockBusy(err: unknown): boolean {
  if (err instanceof HttpException) return false;
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2028') return true;
  if (isSerializationFailure(err)) return true;
  const message = err instanceof Error ? err.message : '';
  return /\b55P03\b|\b57014\b|\b40P01\b|lock timeout|statement timeout|deadlock detected/i.test(message);
}

/**
 * Thua race tx Serializable (Postgres 40001): Prisma báo P2034 với câu ORM, nhưng câu `$queryRaw`/`$executeRaw` ném P2010 với
 * `meta.code === '40001'` (dự phòng: SQLSTATE hoặc "could not serialize access" trong message). Tx đã rollback hết nên chạy lại được.
 */
export function isSerializationFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || err instanceof HttpException) return false;
  const e = err as { code?: unknown; meta?: { code?: unknown } };
  if (e.code === 'P2034' || e.code === '40001') return true;
  if (e.code === 'P2010' && e.meta?.code === '40001') return true;
  const message = err instanceof Error ? err.message : '';
  return /\b40001\b|could not serialize access/i.test(message);
}

/** Dùng trong `.catch()` của một transaction: thua tranh khoá thì 503 (thử lại được), lỗi khác ném nguyên. */
export function throwIfLockBusy(err: unknown): never {
  if (isLockBusy(err)) throw new ServiceUnavailableException(LOCK_BUSY_MESSAGE);
  throw err;
}

/**
 * Postgres chọn tx làm nạn nhân deadlock (40P01; Prisma P2034, hoặc P2010 của câu raw mang mã trong message). Tx đã rollback hết nên
 * chạy lại cả tx một lần là qua; khác với isLockBusy, không gồm hết hạn chờ khoá (chạy lại ngay sẽ lại chờ đúng khoá đó).
 */
export function isDeadlock(err: unknown): boolean {
  if (err instanceof HttpException) return false;
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') return true;
  const message = err instanceof Error ? err.message : '';
  return /\b40P01\b|deadlock detected/i.test(message);
}
