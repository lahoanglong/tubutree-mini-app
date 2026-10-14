import type { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CronLeaderService } from '../../src/common/cron-leader/cron-leader.service';
import { warmPool } from './helpers';

/**
 * Lease chạy cron trên Postgres THẬT: nhiều instance API cùng giành thì đúng một instance giữ lease
 * và chạy cron job, instance còn lại dừng cron; lease hết hạn hoặc được nhả thì instance khác nhận.
 */
function fakeJob() {
  return {
    running: true,
    start() {
      this.running = true;
    },
    stop() {
      this.running = false;
    },
  };
}

function instance(prisma: PrismaService, leaseName: string, ttlMs = 60_000) {
  const job = fakeJob();
  const registry = { getCronJobs: () => new Map([['job', job]]) } as unknown as SchedulerRegistry;
  const svc = new CronLeaderService(prisma, registry, { leaseName, ttlMs, renewMs: 1_000_000 });
  return { svc, job };
}

describe('CronLeaderService (real Postgres)', () => {
  let prisma: PrismaService;
  const lease = `it-cron-${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  afterAll(async () => {
    await prisma.cronLease.deleteMany({ where: { name: { startsWith: 'it-cron-' } } });
    await prisma?.$disconnect();
  });

  it('5 instance giành cùng lúc → đúng 1 instance giữ lease và chạy cron, 4 instance dừng cron', async () => {
    const all = Array.from({ length: 5 }, () => instance(prisma, lease));
    const results = await Promise.all(all.map((i) => i.svc.tick()));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(all.filter((i) => i.job.running)).toHaveLength(1);
    const row = await prisma.cronLease.findUniqueOrThrow({ where: { name: lease } });
    const leader = all[results.indexOf(true)]!;
    expect(row.holder).toBe(leader.svc.instanceId);

    // Leader gia hạn được, instance khác vẫn không giành được khi lease còn hạn.
    expect(await leader.svc.tick()).toBe(true);
    const follower = all.find((i) => i !== leader)!;
    expect(await follower.svc.tick()).toBe(false);
    expect(follower.job.running).toBe(false);

    // Leader tắt (deploy thay container) → nhả lease → instance khác nhận ngay lượt sau.
    await leader.svc.onApplicationShutdown();
    expect(await follower.svc.tick()).toBe(true);
    expect(follower.job.running).toBe(true);
  });

  it('leader chết không nhả lease → instance khác chỉ nhận sau khi lease hết hạn', async () => {
    const name = `${lease}-ttl`;
    const a = instance(prisma, name, 1_000);
    const b = instance(prisma, name, 1_000);
    expect(await a.svc.tick()).toBe(true);
    expect(await b.svc.tick()).toBe(false);
    await new Promise((r) => setTimeout(r, 1_300));
    expect(await b.svc.tick()).toBe(true);
    expect(await a.svc.tick()).toBe(false);
    expect(a.job.running).toBe(false);
  });
});
