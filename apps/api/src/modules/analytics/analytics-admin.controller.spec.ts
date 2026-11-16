import 'reflect-metadata';
import { AnalyticsAdminController } from './analytics-admin.controller';
import type { LaunchWatchService } from './launch-watch.service';
import type { PrismaService } from '../../prisma/prisma.service';

const noLaunchWatch = {} as LaunchWatchService;

describe('AnalyticsAdminController.retentionDaily', () => {
  it('days=200 bị clamp về 90', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { retentionDailySnapshot: { findMany } } as unknown as PrismaService;
    await new AnalyticsAdminController(prisma, noLaunchWatch).retentionDaily('200');
    const since = findMany.mock.calls[0][0].where.date.gte as Date;
    const diffDays = Math.round((Date.now() - since.getTime()) / 86_400_000);
    expect(diffDays).toBeLessThanOrEqual(91);
    expect(diffDays).toBeGreaterThanOrEqual(89);
  });

  it('days không hợp lệ (NaN) → mặc định 30', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { retentionDailySnapshot: { findMany } } as unknown as PrismaService;
    await new AnalyticsAdminController(prisma, noLaunchWatch).retentionDaily('abc');
    const since = findMany.mock.calls[0][0].where.date.gte as Date;
    const diffDays = Math.round((Date.now() - since.getTime()) / 86_400_000);
    expect(diffDays).toBeLessThanOrEqual(31);
    expect(diffDays).toBeGreaterThanOrEqual(29);
  });
});

describe('AnalyticsAdminController.launchWatchSnapshot', () => {
  it('trả nguyên kết quả của LaunchWatchService.getSnapshot', async () => {
    const dto = { generatedAt: '2026-11-16T12:00:00.000Z' };
    const getSnapshot = jest.fn().mockResolvedValue(dto);
    const controller = new AnalyticsAdminController({} as PrismaService, { getSnapshot } as unknown as LaunchWatchService);
    await expect(controller.launchWatchSnapshot()).resolves.toBe(dto);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('GET admin/analytics/launch-watch và chỉ ADMIN (không @AllowStaff)', () => {
    expect(Reflect.getMetadata('path', AnalyticsAdminController)).toBe('admin/analytics');
    expect(Reflect.getMetadata('path', AnalyticsAdminController.prototype.launchWatchSnapshot)).toBe('launch-watch');
    expect(Reflect.getMetadata('method', AnalyticsAdminController.prototype.launchWatchSnapshot)).toBe(0); // RequestMethod.GET
    expect(Reflect.getMetadata('roles', AnalyticsAdminController)).toEqual(['ADMIN']);
  });
});
