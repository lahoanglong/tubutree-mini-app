import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { RunLease } from './run-lease';

const logger = new Logger('RunExclusive');

export const RUN_EXCLUSIVE_TTL_MS = 120_000;

export type ExclusiveResult<T> = { acquired: false } | { acquired: true; value: T };

export type ExclusivePrisma = Pick<PrismaService, '$queryRaw' | '$executeRaw'>;

/**
 * Chạy `fn` khi giành được khoá lượt chạy `run:<key>` trong cron_leases; một lượt khác (replica này hay khác) đang giữ thì trả
 * { acquired: false } mà không chạy `fn`.
 *
 * Thay cho `$transaction(() => pg_try_advisory_xact_lock + việc dài trên kết nối khác)`: transaction đó chiếm một kết nối pool ở
 * trạng thái "idle in transaction" suốt lượt, còn phần việc bên trong xin thêm kết nối — nhiều cron trùng giờ thì cạn pool.
 * Lease chỉ cần một câu lệnh ngắn lúc giành, lúc gia hạn (mỗi ttl/3) và lúc nhả nên không giữ kết nối nào giữa các lần.
 *
 * Process chết giữa lượt thì lease tự hết hạn sau ttl (khác khoá advisory, nhả ngay khi đứt kết nối). Gia hạn thấy lease đã
 * thuộc lượt khác thì chỉ ghi log lỗi: `fn` đang chạy dở không dừng giữa chừng được an toàn.
 */
export async function runExclusive<T>(
  prisma: ExclusivePrisma,
  key: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number } = {},
): Promise<ExclusiveResult<T>> {
  const ttlMs = opts.ttlMs ?? RUN_EXCLUSIVE_TTL_MS;
  const name = `run:${key}`;
  const lease = await RunLease.tryAcquire(prisma, name, ttlMs);
  if (!lease) return { acquired: false };

  let renewing = false;
  let lostLogged = false;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    lease
      .renew()
      .then((ok) => {
        if (!ok && !lostLogged) {
          lostLogged = true;
          logger.error(`Mất khoá lượt chạy ${name} giữa chừng: một lượt khác đã nhận khoá; có thể hai lượt đang chạy chồng nhau.`);
        }
      })
      .catch((err: unknown) => logger.warn(`Gia hạn khoá lượt chạy ${name} lỗi: ${err instanceof Error ? err.message : err}`))
      .finally(() => {
        renewing = false;
      });
  }, Math.max(1, Math.floor(ttlMs / 3)));
  timer.unref();

  try {
    return { acquired: true, value: await fn() };
  } finally {
    clearInterval(timer);
    try {
      await prisma.$executeRaw`DELETE FROM cron_leases WHERE name = ${name} AND holder = ${lease.holder}`;
    } catch {
      /* lease tự hết hạn sau ttl */
    }
  }
}
