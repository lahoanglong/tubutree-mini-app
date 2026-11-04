import 'reflect-metadata';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { CouponCleanupCron } from './coupon-cleanup.cron';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { runExclusive } from '../../common/cron-leader/run-exclusive';
import { holdsLease } from '../../common/cron-leader/run-exclusive.fixtures';

jest.mock('../../common/cron-leader/run-exclusive');

function make(deleteCounts: number[], locked = true) {
  (runExclusive as jest.Mock).mockImplementation(holdsLease(locked));
  const counts = [...deleteCounts];
  const prisma = {
    $executeRaw: jest.fn(async () => counts.shift() ?? 0),
  };
  const config = { get: jest.fn(async (_k: string, fallback: unknown) => fallback) };
  const cron = new CouponCleanupCron(prisma as unknown as PrismaService, config as unknown as SystemConfigService);
  return { cron, prisma };
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

  it('không giành được khoá lượt chạy thì bỏ qua, không xoá', async () => {
    const { cron, prisma } = make([5], false);
    await expect(cron.purgeExpiredPersonal()).resolves.toEqual({ skipped: 'LOCKED' });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('lượt chạy chồng trong cùng instance bị bỏ qua', async () => {
    const { cron } = make([0]);
    let unblock!: () => void;
    (runExclusive as jest.Mock).mockImplementationOnce(() => new Promise((r) => (unblock = () => r({ acquired: true, value: { deleted: 0, batches: 0 } }))));
    const first = cron.purgeExpiredPersonal();
    await expect(cron.purgeExpiredPersonal()).resolves.toEqual({ skipped: 'RUNNING' });
    unblock();
    await first;
  });

  it('lỗi DB trong handleCron không ném ra ngoài', async () => {
    const { cron } = make([]);
    (runExclusive as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    await expect(cron.handleCron()).resolves.toBeUndefined();
  });
});
