import { AnalyticsAggregationService } from './analytics-aggregation.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('AnalyticsAggregationService.computeRetentionSnapshot', () => {
  it('tính đúng ordersPerBuyerMtd = tổng đơn / số buyer distinct trong tháng (chia không tròn)', async () => {
    const queryRawUnsafe = jest.fn()
      .mockResolvedValueOnce([{ new_buyers: 5n, active_buyers: 8n, orders_count: 12n }]) // ngày đang tính
      .mockResolvedValueOnce([{ orders_count: 41n, distinct_buyers: 10n }]) // luỹ kế tháng — CỐ Ý không chia tròn để bắt lỗi bigint-division
      .mockResolvedValueOnce([{ dau: 30n }]); // refresh_tokens proxy
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
      retentionDailySnapshot: { upsert },
    } as unknown as PrismaService;

    const svc = new AnalyticsAggregationService(prisma);
    const result = await svc.computeRetentionSnapshot('2026-09-26');

    expect(result.newBuyers).toBe(5);
    expect(result.activeBuyers).toBe(8);
    expect(result.ordersCount).toBe(12);
    expect(result.ordersPerBuyerMtd).toBeCloseTo(4.1); // 41n/10n phải ra 4.1 (số thực), KHÔNG phải 4 (chia nguyên BigInt)
    expect(result.dauProxyRefreshToken).toBe(30);
    expect(queryRawUnsafe).toHaveBeenNthCalledWith(1, expect.any(String), '2026-09-26');
    expect(queryRawUnsafe).toHaveBeenNthCalledWith(2, expect.any(String), '2026-09-26');
    expect(queryRawUnsafe).toHaveBeenNthCalledWith(3, expect.any(String), '2026-09-26');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date: new Date('2026-09-26') },
        create: expect.objectContaining({ date: new Date('2026-09-26'), dauEventBased: null }),
        update: expect.objectContaining({ computedAt: expect.any(Date) }),
      }),
    );
  });

  it('distinct_buyers = 0 (chưa có đơn tháng này) → ordersPerBuyerMtd = 0, không chia cho 0', async () => {
    const queryRawUnsafe = jest.fn()
      .mockResolvedValueOnce([{ new_buyers: 0n, active_buyers: 0n, orders_count: 0n }])
      .mockResolvedValueOnce([{ orders_count: 0n, distinct_buyers: 0n }])
      .mockResolvedValueOnce([{ dau: 0n }]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
      retentionDailySnapshot: { upsert: jest.fn().mockResolvedValue(undefined) },
    } as unknown as PrismaService;

    const svc = new AnalyticsAggregationService(prisma);
    const result = await svc.computeRetentionSnapshot('2026-09-01');

    expect(result.ordersPerBuyerMtd).toBe(0);
  });
});

describe('AnalyticsAggregationService.runNightly', () => {
  it('tính snapshot cho ngày VN hôm qua và log thành công', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      retentionDailySnapshot: { upsert },
    } as unknown as PrismaService;
    const svc = new AnalyticsAggregationService(prisma);

    await svc.runNightly();

    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('computeRetentionSnapshot throw → runNightly bắt lỗi, không throw ra ngoài (cron không được crash)', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('DB tạm thời không kết nối được')),
      retentionDailySnapshot: { upsert: jest.fn() },
    } as unknown as PrismaService;
    const svc = new AnalyticsAggregationService(prisma);

    await expect(svc.runNightly()).resolves.toBeUndefined();
  });
});
