import { AnalyticsAggregationService } from './analytics-aggregation.service';
import type { PrismaService } from '../../prisma/prisma.service';

/** Giả lập DB theo nội dung truy vấn (thứ tự gọi không quan trọng). */
function fakePrisma(handlers: {
  day?: unknown[]; mtd?: unknown[]; dau?: unknown[]; proxyPrior?: unknown[]; phoneUsers?: unknown[]; userPrior?: unknown[];
}) {
  const queryRawUnsafe = jest.fn(async (sql: string, ..._args: unknown[]) => {
    if (sql.includes('GROUP BY 1, 2')) return handlers.day ?? [];
    if (sql.includes('COUNT(DISTINCT')) return sql.includes('refresh_tokens') ? handlers.dau ?? [] : handlers.mtd ?? [];
    if (sql.includes('"endCustomerKey" = ANY')) return handlers.proxyPrior ?? [];
    if (sql.includes('FROM users u')) return handlers.phoneUsers ?? [];
    if (sql.includes('"userId" = ANY')) return handlers.userPrior ?? [];
    throw new Error('truy vấn không mong đợi: ' + sql);
  });
  const upsert = jest.fn().mockResolvedValue(undefined);
  return { prisma: { $queryRawUnsafe: queryRawUnsafe, retentionDailySnapshot: { upsert } } as unknown as PrismaService, queryRawUnsafe, upsert };
}

describe('AnalyticsAggregationService.computeRetentionSnapshot', () => {
  it('khách mới = khoá khách của ngày chưa có đơn trước đó (SĐT gộp theo tài khoản cùng SĐT, lên hộ theo endCustomerKey, còn lại theo userId)', async () => {
    const { prisma, upsert } = fakePrisma({
      day: [
        { customer_key: '0911', kind: 'PHONE', orders: 2n }, // khách cũ: tài khoản u-old cùng SĐT có đơn trước
        { customer_key: '0922', kind: 'PHONE', orders: 1n }, // khách mới
        { customer_key: 'hash-a', kind: 'PROXY', orders: 1n }, // khách cũ (đơn lên hộ trước đó)
        { customer_key: 'hash-b', kind: 'PROXY', orders: 1n }, // khách mới
        { customer_key: 'u-nophone-old', kind: 'USER', orders: 1n }, // khách cũ
        { customer_key: 'u-nophone-new', kind: 'USER', orders: 1n }, // khách mới
      ],
      phoneUsers: [{ id: 'u-old', customer_key: '0911' }, { id: 'u-new', customer_key: '0922' }],
      userPrior: [{ user_id: 'u-old' }, { user_id: 'u-nophone-old' }],
      proxyPrior: [{ customer_key: 'hash-a' }],
      mtd: [{ orders_count: 41n, distinct_buyers: 10n }],
      dau: [{ dau: 30n }],
    });

    const result = await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-26');

    expect(result.activeBuyers).toBe(6);
    expect(result.ordersCount).toBe(7);
    expect(result.newBuyers).toBe(3);
    expect(result.ordersPerBuyerMtd).toBeCloseTo(4.1); // 41/10 phải ra số thực, KHÔNG phải 4 (chia nguyên BigInt)
    expect(result.dauProxyRefreshToken).toBe(30);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date: new Date('2026-09-26') },
        create: expect.objectContaining({ date: new Date('2026-09-26'), newBuyers: 3, dauEventBased: null }),
        update: expect.objectContaining({ computedAt: expect.any(Date) }),
      }),
    );
  });

  it('không có khoá nào của loại nào thì không chạy truy vấn tra cứu loại đó', async () => {
    const { prisma, queryRawUnsafe } = fakePrisma({ day: [{ customer_key: 'u1', kind: 'USER', orders: 1n }] });

    const result = await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-26');

    expect(result.newBuyers).toBe(1);
    const sqls = queryRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((q) => q.includes('"endCustomerKey" = ANY'))).toBe(false);
    expect(sqls.some((q) => q.includes('FROM users u'))).toBe(false);
  });

  it('mọi truy vấn trên orders/refresh_tokens lọc theo khoảng createdAt (không bọc cột trong hàm làm mất index)', async () => {
    const { prisma, queryRawUnsafe } = fakePrisma({ day: [{ customer_key: '0911', kind: 'PHONE', orders: 1n }], phoneUsers: [{ id: 'u1', customer_key: '0911' }] });

    await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-26');

    for (const [sql] of queryRawUnsafe.mock.calls as Array<[string]>) {
      if (!/FROM (orders|refresh_tokens)/.test(sql)) continue;
      expect(sql).not.toMatch(/"createdAt"\s+AT TIME ZONE/);
      expect(sql).not.toMatch(/ROW_NUMBER|OVER\s*\(/);
    }
  });

  it('truyền ngày VN và danh sách trạng thái tính retention (không gồm CANCELLED/RETURNED)', async () => {
    const { prisma, queryRawUnsafe } = fakePrisma({ day: [{ customer_key: 'u1', kind: 'USER', orders: 1n }] });

    await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-26');

    const dayCall = queryRawUnsafe.mock.calls.find((c) => (c[0] as string).includes('GROUP BY 1, 2'))!;
    expect(dayCall[1]).toBe('2026-09-26');
    expect(dayCall[2]).toEqual(expect.arrayContaining(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED']));
    expect(dayCall[2]).not.toContain('CANCELLED');
    expect(dayCall[2]).not.toContain('RETURNED');
  });

  it('distinct_buyers = 0 (chưa có đơn tháng này) → ordersPerBuyerMtd = 0, không chia cho 0', async () => {
    const { prisma } = fakePrisma({ mtd: [{ orders_count: 0n, distinct_buyers: 0n }], dau: [{ dau: 0n }] });

    const result = await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-01');

    expect(result).toMatchObject({ newBuyers: 0, activeBuyers: 0, ordersCount: 0, ordersPerBuyerMtd: 0 });
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
