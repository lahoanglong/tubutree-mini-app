import 'reflect-metadata';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { CouponCleanupCron } from './coupon-cleanup.cron';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

function make(deleteCounts: number[], locked = true) {
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked }]) };
  const counts = [...deleteCounts];
  const prisma = {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    $executeRaw: jest.fn(async () => counts.shift() ?? 0),
  };
  const config = { get: jest.fn(async (_k: string, fallback: unknown) => fallback) };
  const cron = new CouponCleanupCron(prisma as unknown as PrismaService, config as unknown as SystemConfigService);
  return { cron, prisma, tx };
}

describe('CouponCleanupCron', () => {
  it('@Cron chạy theo giờ Việt Nam', () => {
    const meta = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, CouponCleanupCron.prototype.handleCron);
    expect(meta).toMatchObject({ timeZone: 'Asia/Ho_Chi_Minh' });
  });

  it('lô đầy thì xoá tiếp, dừng khi lô không đầy', async () => {
    const { cron, prisma } = make([5, 5, 3]);
    await expect(cron.purgeExpiredPersonal(new Date(), { batchSize: 5 })).resolves.toEqual({ deleted: 13, batches: 3 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('không giữ được khoá advisory thì bỏ qua, không xoá', async () => {
    const { cron, prisma } = make([5], false);
    await expect(cron.purgeExpiredPersonal()).resolves.toEqual({ skipped: 'LOCKED' });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('lượt chạy chồng trong cùng instance bị bỏ qua', async () => {
    const { cron, prisma } = make([0]);
    let unblock!: () => void;
    (prisma.$transaction as jest.Mock).mockImplementationOnce(() => new Promise((r) => (unblock = () => r({ deleted: 0, batches: 0 }))));
    const first = cron.purgeExpiredPersonal();
    await expect(cron.purgeExpiredPersonal()).resolves.toEqual({ skipped: 'RUNNING' });
    unblock();
    await first;
  });

  it('lỗi DB trong handleCron không ném ra ngoài', async () => {
    const { cron, prisma } = make([]);
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    await expect(cron.handleCron()).resolves.toBeUndefined();
  });
});
