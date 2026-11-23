import 'reflect-metadata';
import { AnalyticsAdminController } from './analytics-admin.controller';
import type { LaunchWatchService } from './launch-watch.service';
import type { PurchaseFunnelService } from './purchase-funnel.service';
import type { PrismaService } from '../../prisma/prisma.service';

const noLaunchWatch = {} as LaunchWatchService;
const noFunnel = {} as PurchaseFunnelService;

describe('AnalyticsAdminController.retentionDaily', () => {
  it('days=200 bị clamp về 90', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { retentionDailySnapshot: { findMany } } as unknown as PrismaService;
    await new AnalyticsAdminController(prisma, noLaunchWatch, noFunnel).retentionDaily('200');
    const since = findMany.mock.calls[0][0].where.date.gte as Date;
    const diffDays = Math.round((Date.now() - since.getTime()) / 86_400_000);
    expect(diffDays).toBeLessThanOrEqual(91);
    expect(diffDays).toBeGreaterThanOrEqual(89);
  });

  it('days không hợp lệ (NaN) → mặc định 30', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { retentionDailySnapshot: { findMany } } as unknown as PrismaService;
    await new AnalyticsAdminController(prisma, noLaunchWatch, noFunnel).retentionDaily('abc');
    const since = findMany.mock.calls[0][0].where.date.gte as Date;
    const diffDays = Math.round((Date.now() - since.getTime()) / 86_400_000);
    expect(diffDays).toBeLessThanOrEqual(31);
    expect(diffDays).toBeGreaterThanOrEqual(29);
  });
});

describe('AnalyticsAdminController.funnelDaily', () => {
  afterEach(() => jest.useRealTimers());

  it('days=30 lúc 10:00 giờ VN lấy từ ngày VN hôm nay − 30 (đủ 30 ngày đã chốt, không mất ngày đầu)', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-24T03:00:00Z') });
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { funnelDailySnapshot: { findMany } } as unknown as PrismaService;
    await new AnalyticsAdminController(prisma, noLaunchWatch, noFunnel).funnelDaily('30');
    expect(findMany.mock.calls[0][0].where.date.gte).toEqual(new Date('2026-10-25T00:00:00Z'));
  });

  it('days=200 bị clamp về 90', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-24T03:00:00Z') });
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { funnelDailySnapshot: { findMany } } as unknown as PrismaService;
    await new AnalyticsAdminController(prisma, noLaunchWatch, noFunnel).funnelDaily('200');
    expect(findMany.mock.calls[0][0].where.date.gte).toEqual(new Date('2026-08-26T00:00:00Z'));
  });
});

describe('AnalyticsAdminController.launchWatchSnapshot', () => {
  it('trả nguyên kết quả của LaunchWatchService.getSnapshot', async () => {
    const dto = {
      generatedAt: '2026-11-16T12:00:00.000Z',
      webhookRejects: {
        thresholdPerHour: 10,
        sources: [{ source: 'pancake', lastHour: 52, last24h: 600, peakPerHour: 60, lastAt: '2026-11-16T11:55:00.000Z', alert: true }],
      },
    };
    const getSnapshot = jest.fn().mockResolvedValue(dto);
    const controller = new AnalyticsAdminController({} as PrismaService, { getSnapshot } as unknown as LaunchWatchService, noFunnel);
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

describe('AnalyticsAdminController.purchaseFunnelSnapshot', () => {
  it('GET admin/analytics/purchase-funnel, chỉ ADMIN, trả nguyên kết quả của PurchaseFunnelService', async () => {
    const dto = { generatedAt: '2026-11-16T12:00:00.000Z' };
    const getSnapshot = jest.fn().mockResolvedValue(dto);
    const controller = new AnalyticsAdminController({} as PrismaService, noLaunchWatch, { getSnapshot } as unknown as PurchaseFunnelService);
    await expect(controller.purchaseFunnelSnapshot()).resolves.toBe(dto);
    expect(Reflect.getMetadata('path', AnalyticsAdminController.prototype.purchaseFunnelSnapshot)).toBe('purchase-funnel');
    expect(Reflect.getMetadata('method', AnalyticsAdminController.prototype.purchaseFunnelSnapshot)).toBe(0);
    expect(Reflect.getMetadata('roles', AnalyticsAdminController)).toEqual(['ADMIN']);
  });
});
