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
 * Không giữ transaction suốt lượt: mỗi cron một kết nối "idle in transaction" cộng kết nối của phần việc sẽ làm cạn pool khi
 * nhiều cron trùng giờ. Lease chỉ cần một câu lệnh ngắn lúc giành, lúc gia hạn (mỗi ttl/3) và lúc nhả nên không giữ kết nối nào giữa các lần.
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

  let inflight: Promise<void> | null = null;
  let lostLogged = false;
  // UPDATE thuần (không INSERT): lease đã bị lượt khác nhận rồi nhả thì dòng không còn, gia hạn kiểu upsert sẽ tạo lại dòng và
  // che mất việc hai lượt đã chạy chồng nhau.
  const renew = async (): Promise<void> => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      UPDATE cron_leases
         SET "expiresAt" = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${ttlMs / 1000}::double precision),
             "updatedAt" = (now() AT TIME ZONE 'UTC')
       WHERE name = ${name} AND holder = ${lease.holder} AND "expiresAt" >= (now() AT TIME ZONE 'UTC')
      RETURNING name`;
    if (rows.length === 0 && !lostLogged) {
      lostLogged = true;
      logger.error(`Mất khoá lượt chạy ${name} giữa chừng: khoá đã hết hạn hoặc bị lượt khác nhận; có thể hai lượt đang chạy chồng nhau.`);
    }
  };
  const timer = setInterval(() => {
    if (inflight || lostLogged) return;
    inflight = renew()
      .catch((err: unknown) => logger.warn(`Gia hạn khoá lượt chạy ${name} lỗi: ${err instanceof Error ? err.message : err}`))
      .finally(() => {
        inflight = null;
      });
  }, Math.max(1, Math.floor(ttlMs / 3)));
  timer.unref();

  try {
    return { acquired: true, value: await fn() };
  } finally {
    clearInterval(timer);
    // Lần gia hạn đang bay mà DELETE commit trước thì nó chưa thấy dòng nào; chờ nó xong rồi mới nhả.
    await inflight;
    try {
      await prisma.$executeRaw`DELETE FROM cron_leases WHERE name = ${name} AND holder = ${lease.holder}`;
    } catch {
      /* lease tự hết hạn sau ttl */
    }
  }
}
