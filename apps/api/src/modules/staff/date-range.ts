import { BadRequestException } from '@nestjs/common';

/**
 * Prisma ném PrismaClientUnknownRequestError (→ 500) khi Date có năm ngoài 0..9999 hoặc năm âm, và
 * cột `year` kiểu Int vỡ khi > 2^31-1. Lịch ca/lương thật chỉ nằm trong khoảng này.
 */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

export function isSaneDate(d: Date): boolean {
  const t = d.getTime();
  if (Number.isNaN(t)) return false;
  const y = d.getUTCFullYear();
  return y >= MIN_YEAR && y <= MAX_YEAR;
}

/** Cùng thông điệp 400 mà 3 controller lịch ca/chấm công đang dùng. */
export function parseDateRange(from: string | undefined, to: string | undefined): { f: Date; t: Date } {
  if (!from || !to) throw new BadRequestException('Thiếu khoảng thời gian (from/to).');
  const f = new Date(from);
  const t = new Date(to);
  if (!isSaneDate(f) || !isSaneDate(t)) throw new BadRequestException('from/to không hợp lệ.');
  return { f, t };
}

export function parseYearMonth(year: string | undefined, month: string | undefined): { y: number; m: number } {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || y < MIN_YEAR || y > MAX_YEAR) {
    throw new BadRequestException('Thiếu hoặc sai year/month.');
  }
  return { y, m };
}
