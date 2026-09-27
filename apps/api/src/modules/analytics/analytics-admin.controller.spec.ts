import { AnalyticsAdminController } from './analytics-admin.controller';
import type { PrismaService } from '../../prisma/prisma.service';

describe('AnalyticsAdminController.retentionDaily', () => {
  it('days=200 bị clamp về 90', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { retentionDailySnapshot: { findMany } } as unknown as PrismaService;
    await new AnalyticsAdminController(prisma).retentionDaily('200');
    const since = findMany.mock.calls[0][0].where.date.gte as Date;
    const diffDays = Math.round((Date.now() - since.getTime()) / 86_400_000);
    expect(diffDays).toBeLessThanOrEqual(91);
    expect(diffDays).toBeGreaterThanOrEqual(89);
  });

  it('days không hợp lệ (NaN) → mặc định 30', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { retentionDailySnapshot: { findMany } } as unknown as PrismaService;
    await new AnalyticsAdminController(prisma).retentionDaily('abc');
    const since = findMany.mock.calls[0][0].where.date.gte as Date;
    const diffDays = Math.round((Date.now() - since.getTime()) / 86_400_000);
    expect(diffDays).toBeLessThanOrEqual(31);
    expect(diffDays).toBeGreaterThanOrEqual(29);
  });
});
