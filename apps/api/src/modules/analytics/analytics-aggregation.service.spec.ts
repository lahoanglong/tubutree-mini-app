import { AnalyticsAggregationService } from './analytics-aggregation.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Giả lập DB theo nội dung truy vấn (thứ tự gọi không quan trọng). Truy vấn theo ngày nhận ngày VN ở tham số đầu:
 * ngày đang tính (`day`) và ngày cohort NS-1 = ngày tính − 30 (`cohortDay`) trả dữ liệu riêng.
 */
function fakePrisma(handlers: {
  day?: unknown[]; cohortDay?: unknown[]; mtd?: unknown[]; dau?: unknown[]; proxyPrior?: unknown[]; phoneUsers?: unknown[]; userPrior?: unknown[];
  proxyOrders?: unknown[]; userOrders?: unknown[];
}, activeDay = '2026-09-26') {
  const queryRawUnsafe = jest.fn(async (sql: string, ...args: unknown[]) => {
    if (sql.includes('GROUP BY 1, 2')) return args[0] === activeDay ? handlers.day ?? [] : handlers.cohortDay ?? [];
    if (sql.includes('AS created_at')) return sql.includes('AS user_id') ? handlers.userOrders ?? [] : handlers.proxyOrders ?? [];
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

  it('mọi khoá đều tra ở cả hai phía (đơn lên hộ và đơn thường): endCustomerKey là SĐT nội địa nên khách tự mua và CTV lên hộ là một người', async () => {
    const { prisma, queryRawUnsafe } = fakePrisma({
      day: [
        { customer_key: '0911', kind: 'PHONE', orders: 1n }, // đã từng được CTV lên hộ -> khách cũ
        { customer_key: '0922', kind: 'PROXY', orders: 1n }, // đã từng tự mua bằng tài khoản -> khách cũ
        { customer_key: '0933', kind: 'PHONE', orders: 1n }, // mới
      ],
      proxyPrior: [{ customer_key: '0911' }],
      phoneUsers: [{ id: 'u-self', customer_key: '0922' }],
      userPrior: [{ user_id: 'u-self' }],
    });

    const result = await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-26');

    expect(result.newBuyers).toBe(1);
    const proxyCall = queryRawUnsafe.mock.calls.find((c) => (c[0] as string).includes('"endCustomerKey" = ANY'))!;
    expect(proxyCall[3]).toEqual(['0911', '0922', '0933']);
    const userCall = queryRawUnsafe.mock.calls.find((c) => (c[0] as string).includes('FROM users u'))!;
    expect(userCall[1]).toEqual(['0911', '0922', '0933']);
  });

  it('ngày không có khoá nào thì không chạy truy vấn tra cứu', async () => {
    const { prisma, queryRawUnsafe } = fakePrisma({});

    await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-26');

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

/**
 * NS-1 (C-032): trong số khách có đơn hợp lệ ĐẦU TIÊN rơi vào ngày VN (ngày tính − 30), bao nhiêu khách có đơn thứ 2
 * trong 30 ngày kể từ đơn đầu. Cohort chỉ là MỘT ngày nên truy vấn theo cửa sổ thời gian nhỏ và đi qua index.
 */
describe('AnalyticsAggregationService.computeRetentionSnapshot — NS-1', () => {
  const H = 3_600_000;
  const first = new Date('2026-08-27T03:00:00Z');
  const at = (offsetHours: number) => new Date(first.getTime() + offsetHours * H);
  const cohortRow = (customer_key: string, kind: string, firstAt = first) => ({ customer_key, kind, orders: 1n, first_at: firstAt });

  it('cohort = khách mới của ngày D−30; lặp = có đơn thứ 2 trong 30 ngày (kể cả cùng ngày đơn đầu), khách cũ không vào cohort', async () => {
    const { prisma, upsert, queryRawUnsafe } = fakePrisma({
      cohortDay: [
        cohortRow('0911', 'PHONE'), // đã có đơn trước ngày cohort -> khách cũ, không vào cohort
        cohortRow('0922', 'PHONE'), // mới, đơn 2 sau 3 ngày -> lặp
        cohortRow('0933', 'PHONE'), // mới, đơn 2 sau 31 ngày -> quá cửa sổ 30 ngày
        cohortRow('0944', 'PHONE'), // mới, đơn 2 ngay trong ngày cohort -> lặp
        cohortRow('hash-b', 'PROXY'), // mới (đơn lên hộ), đơn 2 sau 10 ngày -> lặp
        cohortRow('u-new', 'USER'), // mới, chỉ một đơn -> không lặp
      ],
      phoneUsers: [
        { id: 'u-old', customer_key: '0911' }, { id: 'u-22', customer_key: '0922' },
        { id: 'u-33', customer_key: '0933' }, { id: 'u-44', customer_key: '0944' },
      ],
      userPrior: [{ user_id: 'u-old' }],
      userOrders: [
        { user_id: 'u-22', created_at: first }, { user_id: 'u-22', created_at: at(72) },
        { user_id: 'u-33', created_at: first }, { user_id: 'u-33', created_at: at(31 * 24) },
        { user_id: 'u-44', created_at: first }, { user_id: 'u-44', created_at: at(1) },
        { user_id: 'u-new', created_at: first },
      ],
      proxyOrders: [{ customer_key: 'hash-b', created_at: first }, { customer_key: 'hash-b', created_at: at(240) }],
    });

    await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-26');

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ ns1CohortSize: 5, ns1RepeatCount: 3 }),
        update: expect.objectContaining({ ns1CohortSize: 5, ns1RepeatCount: 3 }),
      }),
    );
    // Ngày cohort = ngày tính − 30 ngày (VN): 2026-09-26 → 2026-08-27.
    const cohortCall = (queryRawUnsafe.mock.calls as Array<[string, ...unknown[]]>).find(
      ([sql, day]) => sql.includes('GROUP BY 1, 2') && day === '2026-08-27',
    );
    expect(cohortCall).toBeDefined();
  });

  it('đơn thứ 2 tính tới đúng mốc đơn đầu + 30 ngày; khách chỉ có đơn đầu thì không lặp', async () => {
    const { prisma, upsert } = fakePrisma({
      cohortDay: [cohortRow('0922', 'PHONE'), cohortRow('0933', 'PHONE')],
      phoneUsers: [{ id: 'u-22', customer_key: '0922' }, { id: 'u-33', customer_key: '0933' }],
      userOrders: [
        { user_id: 'u-22', created_at: first }, { user_id: 'u-22', created_at: at(30 * 24) }, // đúng mốc 30 ngày -> vẫn tính
        { user_id: 'u-33', created_at: first }, // chỉ có đơn đầu -> không lặp
      ],
    });

    await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-26');

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ ns1CohortSize: 2, ns1RepeatCount: 1 }) }),
    );
  });

  it('hai tài khoản cùng SĐT là một khách: đơn đầu ở tài khoản này, đơn 2 ở tài khoản kia vẫn là lặp', async () => {
    const { prisma, upsert } = fakePrisma({
      cohortDay: [cohortRow('0922', 'PHONE')],
      phoneUsers: [{ id: 'u-a', customer_key: '0922' }, { id: 'u-b', customer_key: '0922' }],
      userOrders: [{ user_id: 'u-a', created_at: first }, { user_id: 'u-b', created_at: at(48) }],
    });

    await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-26');

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ ns1CohortSize: 1, ns1RepeatCount: 1 }) }),
    );
  });

  it('khách PHONE được tra cả đơn lên hộ theo endCustomerKey (CTV lên hộ đúng SĐT đó là cùng một khách)', async () => {
    const { prisma, upsert } = fakePrisma({
      cohortDay: [cohortRow('0922', 'PHONE')],
      phoneUsers: [{ id: 'u-a', customer_key: '0922' }],
      userOrders: [{ user_id: 'u-a', created_at: first }],
      proxyOrders: [{ customer_key: '0922', created_at: at(24) }],
    });

    await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-26');

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ ns1CohortSize: 1, ns1RepeatCount: 1 }) }),
    );
  });

  it('cohort rỗng (ngày D−30 chỉ có khách cũ) → 0/0 và không chạy truy vấn đếm đơn lặp', async () => {
    const { prisma, upsert, queryRawUnsafe } = fakePrisma({
      cohortDay: [cohortRow('0911', 'PHONE')],
      phoneUsers: [{ id: 'u-old', customer_key: '0911' }],
      userPrior: [{ user_id: 'u-old' }],
    });

    await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-26');

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ ns1CohortSize: 0, ns1RepeatCount: 0 }) }),
    );
    const sqls = (queryRawUnsafe.mock.calls as Array<[string]>).map(([sql]) => sql);
    expect(sqls.some((sql) => sql.includes('AS created_at'))).toBe(false);
  });

  it('truy vấn đếm đơn lặp chỉ quét cửa sổ [đầu ngày cohort, +31 ngày) theo createdAt, không bọc cột trong hàm, không window function', async () => {
    const { prisma, queryRawUnsafe } = fakePrisma({
      cohortDay: [cohortRow('0922', 'PHONE'), cohortRow('u-new', 'USER')],
      phoneUsers: [{ id: 'u-22', customer_key: '0922' }],
    });

    await new AnalyticsAggregationService(prisma).computeRetentionSnapshot('2026-09-26');

    const repeatCalls = (queryRawUnsafe.mock.calls as Array<[string, ...unknown[]]>).filter(([sql]) => sql.includes('AS created_at'));
    expect(repeatCalls.length).toBe(2);
    for (const [sql, ...args] of repeatCalls) {
      expect(args[0]).toBe('2026-08-27');
      expect(sql).toContain(`o."createdAt" >= ($1::date)::timestamp - interval '7 hours'`);
      expect(sql).toContain(`interval '31 days'`);
      expect(sql).not.toMatch(/"createdAt"\s+AT TIME ZONE/);
      expect(sql).not.toMatch(/ROW_NUMBER|OVER\s*\(/);
    }
  });
});

describe('AnalyticsAggregationService.backfillNs1 — điền NS-1 cho snapshot cũ mà không đụng các cột khác', () => {
  function make(existing: { date: Date } | null, handlers: Parameters<typeof fakePrisma>[0] = {}) {
    const { prisma, queryRawUnsafe } = fakePrisma(handlers);
    const findFirst = jest.fn().mockResolvedValue(existing);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    (prisma as unknown as { retentionDailySnapshot: Record<string, unknown> }).retentionDailySnapshot = { findFirst, updateMany, upsert: jest.fn() };
    return { svc: new AnalyticsAggregationService(prisma), findFirst, updateMany, queryRawUnsafe };
  }

  it('chỉ ghi hai cột ns1, chỉ khi dòng đó còn NULL (updateMany có điều kiện ns1CohortSize null)', async () => {
    const first = new Date('2026-08-27T03:00:00Z');
    const { svc, updateMany } = make(
      { date: new Date('2026-09-26') },
      {
        cohortDay: [{ customer_key: 'u-1', kind: 'USER', orders: 1n, first_at: first }],
        userOrders: [{ user_id: 'u-1', created_at: first }, { user_id: 'u-1', created_at: new Date(first.getTime() + 86_400_000) }],
      },
    );

    await expect(svc.backfillNs1('2026-09-26')).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: { date: new Date('2026-09-26'), ns1CohortSize: null },
      data: { ns1CohortSize: 1, ns1RepeatCount: 1 },
    });
  });

  it('không có snapshot hoặc đã có NS-1 → không tính, không ghi (không tạo dòng mới làm retention job tưởng ngày đó đã chốt)', async () => {
    const { svc, updateMany, queryRawUnsafe } = make(null);

    await expect(svc.backfillNs1('2026-09-26')).resolves.toBe(false);

    expect(updateMany).not.toHaveBeenCalled();
    expect(queryRawUnsafe).not.toHaveBeenCalled();
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
