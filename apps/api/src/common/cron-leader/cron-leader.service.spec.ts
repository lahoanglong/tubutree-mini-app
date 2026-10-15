import { SchedulerRegistry } from '@nestjs/schedule';
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

  it('onLeadership: chạy đúng một lần khi vừa giành lease, không chạy khi gia hạn hay khi không phải leader (R2-PLATFORM-8)', async () => {
    const exec = jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const { svc } = setup(exec);
    const hook = jest.fn();
    svc.onLeadership(hook);
    await svc.tick();
    expect(hook).not.toHaveBeenCalled();
    await svc.tick();
    await svc.tick();
    expect(hook).toHaveBeenCalledTimes(1);
    await svc.tick();
    await svc.tick();
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it('onLeadership đăng ký khi đã là leader → chạy ngay; hook ném lỗi không làm hỏng tick', async () => {
    const { svc, jobs } = setup(jest.fn().mockResolvedValue(1));
    await svc.tick();
    const hook = jest.fn();
    svc.onLeadership(hook);
    expect(hook).toHaveBeenCalledTimes(1);
    const { svc: svc2 } = setup(jest.fn().mockResolvedValue(1));
    svc2.onLeadership(() => {
      throw new Error('boom');
    });
    await expect(svc2.tick()).resolves.toBe(true);
    expect(jobs.every((j) => j.running)).toBe(true);
  });

  describe('job vừa đăng ký khi chưa giữ lease bị dừng ngay (R5-SYNC-2)', () => {
    type Job = Parameters<SchedulerRegistry['addCronJob']>[1];
    /** Như CronJob của ScheduleModule lúc mount: tạo xong là đã chạy. */
    const job = () => {
      const j = {
        running: true,
        fireOnTick: () => undefined,
        start: () => {
          j.running = true;
        },
        stop: () => {
          j.running = false;
        },
      };
      return j as unknown as Job;
    };

    it('ScheduleModule bật job lúc bootstrap (trước app.listen, trước khi hỏi lease) → job dừng ngay khi đăng ký', () => {
      const registry = new SchedulerRegistry();
      new CronLeaderService({ $executeRaw: jest.fn() } as unknown as PrismaService, registry, { renewMs: 1_000_000 });
      const j = job();
      registry.addCronJob('j', j);
      expect(j.running).toBe(false);
      expect(registry.getCronJob('j')).toBe(j);
    });

    it('đang giữ lease → job đăng ký sau vẫn chạy; mất lease thì dừng như mọi job', async () => {
      const exec = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      const registry = new SchedulerRegistry();
      const svc = new CronLeaderService({ $executeRaw: exec } as unknown as PrismaService, registry, { renewMs: 1_000_000 });
      await svc.tick();
      const j = job();
      registry.addCronJob('j', j);
      expect(j.running).toBe(true);
      await svc.tick();
      expect(j.running).toBe(false);
    });
  });
});
