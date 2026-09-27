import { AnalyticsAggregationService } from './analytics-aggregation.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('AnalyticsAggregationService.computeRetentionSnapshot', () => {
  it('tính đúng ordersPerBuyerMtd = tổng đơn / số buyer distinct trong tháng', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{ new_buyers: 5n, active_buyers: 8n, orders_count: 12n }]) // ngày đang tính
        .mockResolvedValueOnce([{ orders_count: 40n, distinct_buyers: 10n }]) // luỹ kế tháng
        .mockResolvedValueOnce([{ dau: 30n }]), // refresh_tokens proxy
      retentionDailySnapshot: { upsert: jest.fn().mockResolvedValue(undefined) },
    } as unknown as PrismaService;

    const svc = new AnalyticsAggregationService(prisma);
    const result = await svc.computeRetentionSnapshot(new Date('2026-09-26'));

    expect(result.newBuyers).toBe(5);
    expect(result.activeBuyers).toBe(8);
    expect(result.ordersCount).toBe(12);
    expect(result.ordersPerBuyerMtd).toBeCloseTo(4);
    expect(result.dauProxyRefreshToken).toBe(30);
    expect(prisma.retentionDailySnapshot.upsert).toHaveBeenCalledTimes(1);
  });
});
