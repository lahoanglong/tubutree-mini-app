import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Khoá theo LƯỢT CHẠY trong bảng cron_leases, chung cho mọi replica: một việc dài (vd. đồng bộ danh mục Pancake) chỉ chạy một
 * lượt một lúc trên cả cụm, kể cả lượt do admin bấm — lượt đó không đi qua cron leader nên cờ trong bộ nhớ không chặn được
 * replica khác. Người giữ gia hạn trong lúc chạy; process chết giữa chừng thì khoá tự hết hạn sau ttl. Đồng hồ là now() của
 * Postgres để các máy lệch giờ vẫn so cùng một mốc.
 *
 * Không dùng khoá advisory theo transaction như các cron ngắn: lượt đồng bộ chạy nhiều phút, gọi Pancake giữa chừng — giữ một
 * transaction mở suốt chừng ấy là chiếm kết nối DB và đụng hạn chờ transaction.
 */
export class RunLease {
  private constructor(
    private readonly prisma: Pick<PrismaService, '$queryRaw'>,
    readonly name: string,
    readonly holder: string,
    private readonly ttlMs: number,
  ) {}

  /** Giành khoá; null khi một lượt khác (replica này hay replica khác) đang giữ và chưa hết hạn. */
  static async tryAcquire(prisma: Pick<PrismaService, '$queryRaw'>, name: string, ttlMs: number): Promise<RunLease | null> {
    const lease = new RunLease(prisma, name, `${hostname()}:${process.pid}:${randomUUID()}`, ttlMs);
    return (await lease.claim()) ? lease : null;
  }

  /** Gia hạn thêm ttl. false = khoá đã hết hạn và lượt khác đã nhận — người gọi phải dừng, không ghi tiếp. */
  renew(): Promise<boolean> {
    return this.claim();
  }

  /** Nhả khoá để lượt sau chạy ngay. Lỗi thì bỏ qua: khoá tự hết hạn sau ttl. */
  async release(): Promise<void> {
    try {
      await this.prisma.$queryRaw`
        UPDATE cron_leases SET "expiresAt" = (now() AT TIME ZONE 'UTC'), "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE name = ${this.name} AND holder = ${this.holder}
        RETURNING name`;
    } catch {
      /* khoá tự hết hạn sau ttl */
    }
  }

  private async claim(): Promise<boolean> {
    const ttlSeconds = this.ttlMs / 1000;
    const rows = await this.prisma.$queryRaw<{ holder: string }[]>`
      INSERT INTO cron_leases (name, holder, "expiresAt", "updatedAt")
      VALUES (
        ${this.name}, ${this.holder},
        (now() AT TIME ZONE 'UTC') + make_interval(secs => ${ttlSeconds}::double precision),
        (now() AT TIME ZONE 'UTC')
      )
      ON CONFLICT (name) DO UPDATE
        SET holder = EXCLUDED.holder, "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt"
        WHERE cron_leases.holder = EXCLUDED.holder OR cron_leases."expiresAt" < (now() AT TIME ZONE 'UTC')
      RETURNING holder`;
    return rows.length === 1;
  }
}
