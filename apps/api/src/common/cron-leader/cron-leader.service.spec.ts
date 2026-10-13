import type { SchedulerRegistry } from '@nestjs/schedule';
import type { PrismaService } from '../../prisma/prisma.service';
import { CronLeaderService } from './cron-leader.service';

function setup(executeRaw: jest.Mock) {
  const jobs = [0, 1].map(() => ({
    running: true,
    start: jest.fn(function (this: { running: boolean }) {
      this.running = true;
    }),
    stop: jest.fn(function (this: { running: boolean }) {
      this.running = false;
    }),
  }));
  const registry = { getCronJobs: () => new Map(jobs.map((j, i) => [`j${i}`, j])) } as unknown as SchedulerRegistry;
  const prisma = { $executeRaw: executeRaw } as unknown as PrismaService;
  const svc = new CronLeaderService(prisma, registry, { renewMs: 1_000_000 });
  return { svc, jobs };
}

describe('CronLeaderService', () => {
  afterEach(() => jest.useRealTimers());

  it('giữ được lease → mọi cron job chạy', async () => {
    const { svc, jobs } = setup(jest.fn().mockResolvedValue(1));
    jobs.forEach((j) => j.stop());
    await expect(svc.tick()).resolves.toBe(true);
    expect(jobs.every((j) => j.running)).toBe(true);
  });

  it('instance khác đang giữ lease → dừng mọi cron job', async () => {
    const { svc, jobs } = setup(jest.fn().mockResolvedValue(0));
    await expect(svc.tick()).resolves.toBe(false);
    expect(jobs.every((j) => !j.running)).toBe(true);
  });

  it('DB lỗi khi gia hạn → dừng cron (không chắc còn là leader), lượt sau thử lại', async () => {
    const exec = jest.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(1);
    const { svc, jobs } = setup(exec);
    await svc.tick();
    await expect(svc.tick()).resolves.toBe(false);
    expect(jobs.every((j) => !j.running)).toBe(true);
    await expect(svc.tick()).resolves.toBe(true);
    expect(jobs.every((j) => j.running)).toBe(true);
  });

  it('start() dừng cron NGAY (trước khi hỏi DB) để instance chưa giành lease không chạy lượt nào', () => {
    let resolveLease!: (n: number) => void;
    const { svc, jobs } = setup(jest.fn(() => new Promise((r) => (resolveLease = r))));
    svc.start();
    expect(jobs.every((j) => !j.running)).toBe(true);
    resolveLease(0);
    svc.onApplicationShutdown();
  });
});
