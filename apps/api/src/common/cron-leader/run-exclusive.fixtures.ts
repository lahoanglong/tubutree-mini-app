import type { ExclusiveResult } from './run-exclusive';

/** Cho spec cron: thay runExclusive đã jest.mock bằng bản giả giành được hoặc không giành được khoá, còn `fn` chạy thật. */
export function holdsLease(acquired: boolean) {
  return async <T>(_prisma: unknown, _key: string, fn: () => Promise<T>): Promise<ExclusiveResult<T>> =>
    acquired ? { acquired: true, value: await fn() } : { acquired: false };
}
