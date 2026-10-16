import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const LOCK_BUSY_MESSAGE = 'Hệ thống đang bận, vui lòng thử lại sau ít giây.';

/**
 * Thua tranh khoá, thử lại là qua: hạn chờ khoá/câu lệnh/tx (55P03 lock_timeout, 57014 statement_timeout, P2028 Prisma huỷ tx)
 * hoặc bị Postgres chọn làm nạn nhân deadlock (40P01, Prisma P2034). Câu raw ném lỗi Postgres trong message (P2010) nên dò cả
 * mã SQLSTATE trong đó.
 */
export function isLockBusy(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2028' || err.code === 'P2034')) return true;
  const message = err instanceof Error ? err.message : '';
  return /\b55P03\b|\b57014\b|\b40P01\b|lock timeout|statement timeout|deadlock detected/i.test(message);
}

/** Dùng trong `.catch()` của một transaction: thua tranh khoá thì 503 (thử lại được), lỗi khác ném nguyên. */
export function throwIfLockBusy(err: unknown): never {
  if (isLockBusy(err)) throw new ServiceUnavailableException(LOCK_BUSY_MESSAGE);
  throw err;
}
