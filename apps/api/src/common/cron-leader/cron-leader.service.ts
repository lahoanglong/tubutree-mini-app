import { Inject, Injectable, Logger, OnApplicationShutdown, Optional } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from '../../prisma/prisma.service';

export const CRON_LEADER_OPTIONS = Symbol('CRON_LEADER_OPTIONS');

export interface CronLeaderOptions {
  leaseName: string;
  /** Lease hết hạn sau khoảng này nếu leader không gia hạn (tiến trình chết, mất DB). */
  ttlMs: number;
  /** Chu kỳ giành/gia hạn lease. Phải nhỏ hơn hẳn ttlMs. */
  renewMs: number;
}

const DEFAULTS: CronLeaderOptions = { leaseName: 'cron', ttlMs: 90_000, renewMs: 30_000 };

/**
 * Chỉ MỘT instance API chạy @Cron. Phần lớn cron (đồng bộ tồn kho Pancake, remarketing, voucher sinh
 * nhật/win-back, nhắc game, hết hạn đơn chờ thanh toán, reconcile Pancake/Gomdon...) chỉ có cờ
 * `running` trong bộ nhớ, nên hai instance (scale, hoặc container cũ/mới chồng nhau) sẽ gửi thông
 * báo/voucher trùng và đồng bộ chồng nhau. Thay vì khoá từng cron, các instance giành một lease
 * trong DB (bảng cron_leases); instance không giữ lease dừng mọi cron job của nó, giữ lease thì
 * bật lại. Đồng hồ dùng now() của Postgres để các máy lệch giờ vẫn so cùng một mốc.
 *
 * BullMQ worker không bị ảnh hưởng: job queue vốn chia đều được cho nhiều instance.
 */
@Injectable()
export class CronLeaderService implements OnApplicationShutdown {
  private readonly logger = new Logger(CronLeaderService.name);
  private readonly opts: CronLeaderOptions;
  readonly instanceId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private timer?: NodeJS.Timeout;
  private leader: boolean | undefined;
  private readonly leadershipHooks: (() => void)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SchedulerRegistry,
    @Optional() @Inject(CRON_LEADER_OPTIONS) opts?: Partial<CronLeaderOptions>,
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** Gọi sau khi app đã bootstrap (main.ts): lúc đó ScheduleModule đã tạo và bật mọi cron job. */
  start(): void {
    this.setJobsRunning(false);
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.opts.renewMs);
    this.timer.unref();
  }

  /**
   * Việc chỉ leader được làm ngoài @Cron (vd. đồng bộ catalog lúc khởi động): chạy mỗi lần instance này VỪA giành
   * được lease — lúc boot, hoặc khi leader cũ chết. Đã là leader thì chạy ngay. Hook tự lo lỗi bất đồng bộ của nó.
   */
  onLeadership(fn: () => void): void {
    this.leadershipHooks.push(fn);
    if (this.leader) this.runHook(fn);
  }

  private runHook(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.logger.error(`Việc khi vừa thành leader lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  async tick(): Promise<boolean> {
    let acquired = false;
    try {
      acquired = await this.tryAcquire();
    } catch (err) {
      this.logger.error(`Không giành/gia hạn được lease cron: ${err instanceof Error ? err.message : err}`);
    }
    if (acquired !== this.leader) {
      this.logger.log(acquired ? `Instance ${this.instanceId} chạy cron.` : `Instance ${this.instanceId} dừng cron.`);
    }
    const promoted = acquired && !this.leader;
    this.leader = acquired;
    this.setJobsRunning(acquired);
    if (promoted) this.leadershipHooks.forEach((fn) => this.runHook(fn));
    return acquired;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!this.leader) return;
    this.leader = false;
    try {
      await this.prisma.$executeRaw`
        UPDATE cron_leases SET "expiresAt" = (now() AT TIME ZONE 'UTC')
        WHERE name = ${this.opts.leaseName} AND holder = ${this.instanceId}`;
    } catch {
      /* lease tự hết hạn sau ttlMs */
    }
  }

  private async tryAcquire(): Promise<boolean> {
    const ttlSeconds = this.opts.ttlMs / 1000;
    const rows = await this.prisma.$executeRaw`
      INSERT INTO cron_leases (name, holder, "expiresAt", "updatedAt")
      VALUES (
        ${this.opts.leaseName}, ${this.instanceId},
        (now() AT TIME ZONE 'UTC') + make_interval(secs => ${ttlSeconds}::double precision),
        (now() AT TIME ZONE 'UTC')
      )
      ON CONFLICT (name) DO UPDATE
        SET holder = EXCLUDED.holder, "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt"
        WHERE cron_leases.holder = EXCLUDED.holder OR cron_leases."expiresAt" < (now() AT TIME ZONE 'UTC')`;
    return rows === 1;
  }

  private setJobsRunning(run: boolean): void {
    for (const job of this.registry.getCronJobs().values()) {
      if (run && !job.running) job.start();
      if (!run && job.running) job.stop();
    }
  }
}
