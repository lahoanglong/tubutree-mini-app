import { BadRequestException } from '@nestjs/common';
import { MembershipTier, Prisma } from '@prisma/client';
import { LoyaltyService } from './loyalty.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { vnDateKey } from '../../common/vn-time';

function makeConfig(): SystemConfigService {
  return { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
}

const coupon = (code: string, scope: string, scopeMeta: unknown) => ({
  code,
  scope,
  scopeMeta,
  type: 'AMOUNT',
  value: 10000,
  minOrder: null,
  maxDiscount: null,
  endAt: new Date(Date.now() + 864e5),
  perUserLimit: 1,
  id: code,
});

describe('LoyaltyService.getAvailableCoupons', () => {
  it('lọc đúng scope: PUBLIC + USER_GROUP(của mình) + TIER(khớp); ẩn của user khác / tier khác / INVITE / TIER thiếu meta', async () => {
    const coupons = [
      coupon('PUB', 'PUBLIC', null),
      coupon('MINE', 'USER_GROUP', { userId: 'me' }),
      coupon('OTHER', 'USER_GROUP', { userId: 'someone-else' }),
      coupon('TIER_OK', 'TIER', { tierId: 't1' }),
      coupon('TIER_NO', 'TIER', { tierId: 't2' }),
      // TIER thiếu tierId (admin quên set): assertScopeOwnership từ chối ở redeem nên KHÔNG
      // được hiện trong list — nếu hiện sẽ thành list/apply lệch (coupon hiện mà redeem fail).
      coupon('TIER_NOMETA', 'TIER', {}),
      coupon('INVITE', 'INVITE', null),
    ];
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'me', tierId: 't1', zaloId: 'z-me', phone: null }) },
      // SQL đã thu hẹp ứng viên; mock trả sẵn tập đó, isCouponEligible vẫn là chốt chặn cuối.
      $queryRaw: jest.fn().mockResolvedValue(coupons.map((c) => ({ id: c.id }))),
      coupon: { findMany: jest.fn().mockResolvedValue(coupons) },
      couponRedemption: { groupBy: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    const svc = new LoyaltyService(prisma, makeConfig());
    const result = await svc.getAvailableCoupons('me');
    const codes = result.map((c) => c.code).sort();

    expect(codes).toEqual(['MINE', 'PUB', 'TIER_OK']);
  });

  it('UAT p6: ẩn mã đã tắt; tài khoản khách không thấy mã công khai giới hạn theo người (validate cũng từ chối)', async () => {
    const coupons = [
      coupon('PUB', 'PUBLIC', null),
      { ...coupon('PUB_OFF', 'PUBLIC', null), isActive: false },
      { ...coupon('PUB_UNLIM', 'PUBLIC', null), perUserLimit: 0 },
      coupon('MINE', 'USER_GROUP', { userId: 'me' }),
    ];
    const prismaFor = (user: unknown) =>
      ({
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user) },
        $queryRaw: jest.fn().mockResolvedValue(coupons.map((c) => ({ id: c.id }))),
        coupon: { findMany: jest.fn().mockResolvedValue(coupons) },
        couponRedemption: { groupBy: jest.fn().mockResolvedValue([]) },
      }) as unknown as PrismaService;
    const real = await new LoyaltyService(prismaFor({ id: 'me', tierId: null, zaloId: 'z-me', phone: null }), makeConfig()).getAvailableCoupons('me');
    expect(real.map((c) => c.code).sort()).toEqual(['MINE', 'PUB', 'PUB_UNLIM']);
    const guest = await new LoyaltyService(prismaFor({ id: 'me', tierId: null, zaloId: 'guest_d1', phone: null }), makeConfig()).getAvailableCoupons('me');
    expect(guest.map((c) => c.code).sort()).toEqual(['MINE', 'PUB_UNLIM']);
  });

  it('R2-BUYERMINI-3: mã chỉ áp cho sản phẩm cụ thể (mua chung) trả kèm danh sách sản phẩm áp dụng; mã chung trả null', async () => {
    const coupons = [
      coupon('PUB', 'PUBLIC', null),
      { ...coupon('GBUY-1', 'USER_GROUP', { userId: 'me', groupBuyId: 'g1' }), applyTo: { productIds: ['p-chia'] } },
    ];
    const productFindMany = jest.fn().mockResolvedValue([{ id: 'p-chia', name: 'Hạt chia Úc' }]);
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'me', tierId: null, zaloId: 'z-me', phone: null }) },
      $queryRaw: jest.fn().mockResolvedValue(coupons.map((c) => ({ id: c.id }))),
      coupon: { findMany: jest.fn().mockResolvedValue(coupons) },
      couponRedemption: { groupBy: jest.fn().mockResolvedValue([]) },
      product: { findMany: productFindMany },
    } as unknown as PrismaService;
    const result = await new LoyaltyService(prisma, makeConfig()).getAvailableCoupons('me');
    expect(result.find((c) => c.code === 'PUB')!.products).toBeNull();
    expect(result.find((c) => c.code === 'GBUY-1')!.products).toEqual([{ id: 'p-chia', name: 'Hạt chia Úc' }]);
    expect(productFindMany).toHaveBeenCalledWith({ where: { id: { in: ['p-chia'] } }, select: { id: true, name: true } });
  });

  it('không có ứng viên nào từ SQL thì không nạp coupon nào', async () => {
    const findMany = jest.fn();
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'me', tierId: null }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      coupon: { findMany },
      couponRedemption: { groupBy: jest.fn() },
    } as unknown as PrismaService;

    const result = await new LoyaltyService(prisma, makeConfig()).getAvailableCoupons('me');
    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('ẩn coupon đã dùng hết lượt cá nhân (perUserLimit)', async () => {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'me', tierId: null, zaloId: 'z-me', phone: null }) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'PUB' }]),
      coupon: { findMany: jest.fn().mockResolvedValue([coupon('PUB', 'PUBLIC', null)]) },
      // groupBy trả về số redemption của user cho từng coupon (đã dùng 1 = perUserLimit).
      couponRedemption: {
        groupBy: jest.fn().mockResolvedValue([{ couponId: 'PUB', _count: { _all: 1 } }]),
      },
    } as unknown as PrismaService;

    const svc = new LoyaltyService(prisma, makeConfig());
    const result = await svc.getAvailableCoupons('me');
    expect(result).toHaveLength(0);
  });
});

describe('LoyaltyService.creditOrderPoints', () => {
  function prismaFor(order: unknown, existed: unknown = null) {
    const txn = jest.fn().mockResolvedValue([]);
    const prisma = {
      order: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(order),
        aggregate: jest.fn().mockResolvedValue({ _sum: { total: 0 } }), // recalcTier
      },
      pointsTransaction: { findFirst: jest.fn().mockResolvedValue(existed), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _sum: { delta: 0 } }) },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', pointsBalance: 0, tierId: null }),
        update: jest.fn(),
      },
      membershipTier: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: txn,
    } as unknown as PrismaService;
    return { prisma, txn };
  }

  it('pointsEarned <= 0 → không cộng', async () => {
    const { prisma, txn } = prismaFor({ id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 0 });
    await new LoyaltyService(prisma, makeConfig()).creditOrderPoints('o1');
    expect(txn).not.toHaveBeenCalled();
  });

  it('đã cộng rồi (cùng reason) → idempotent, không cộng lại', async () => {
    const { prisma, txn } = prismaFor({ id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50 }, { id: 'tx-old' });
    await new LoyaltyService(prisma, makeConfig()).creditOrderPoints('o1');
    expect(txn).not.toHaveBeenCalled();
  });

  it('lần đầu → cộng điểm (transaction) + recalc tier', async () => {
    const { prisma, txn } = prismaFor({ id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50 });
    await new LoyaltyService(prisma, makeConfig()).creditOrderPoints('o1');
    expect(txn).toHaveBeenCalledTimes(1);
  });

  it('race: webhook DELIVERED thứ 2 ăn P2002 từ unique index → idempotent (KHÔNG throw, VẪN recalc tier)', async () => {
    // pre-check findFirst=null (cả 2 caller chưa thấy bản ghi), $transaction reject P2002 do partial
    // unique index (reason, refId). Catch RE-QUERY thấy bản ghi reason kẻ-thắng đã commit → bail im lặng.
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const userFind = jest.fn().mockResolvedValue({ id: 'u1', pointsBalance: 0, tierId: null });
    // findFirst: lần 1 (pre-check)=null → đi tiếp; lần 2 (re-query trong catch)=có bản ghi → skip.
    const findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'tx-winner' });
    const prisma = {
      order: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50 }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { total: 0 } }), // recalcTier
      },
      pointsTransaction: { findFirst, create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _sum: { delta: 0 } }) },
      user: { findUniqueOrThrow: userFind, update: jest.fn() },
      membershipTier: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockRejectedValue(p2002),
    } as unknown as PrismaService;

    await expect(
      new LoyaltyService(prisma, makeConfig()).creditOrderPoints('o1'),
    ).resolves.toBeUndefined();
    // Bail idempotent ở nhánh P2002/already VẪN phải recalcTier (gọi user.findUniqueOrThrow) —
    // nếu không, user có thể kẹt vĩnh viễn không có tier (candidate 2, audit loyalty).
    expect(userFind).toHaveBeenCalled();
  });

  it('P2002 từ constraint KHÁC (re-query KHÔNG thấy bản ghi reason) → re-throw, KHÔNG nuốt lỗi', async () => {
    // P2002 không phải từ idempotency index credit này → bản ghi reason vẫn chưa tồn tại →
    // phải ném lỗi để không âm thầm mất điểm.
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    const prisma = {
      order: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50 }),
      },
      // pre-check=null VÀ re-query trong catch cũng=null (không có bản ghi reason).
      pointsTransaction: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _sum: { delta: 0 } }) },
      user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      $transaction: jest.fn().mockRejectedValue(p2002),
    } as unknown as PrismaService;

    await expect(
      new LoyaltyService(prisma, makeConfig()).creditOrderPoints('o1'),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

/**
 * tx giả cho reverseOrderPoints. `balance` là số dư mà câu khoá dòng user (SELECT ... FOR UPDATE) trả về; `ledger` là sổ lô
 * STANDARD mà lần đọc trong tx thấy. Mặc định sổ chỉ có đúng lô ORDER_DELIVERED của đơn (còn nguyên, chưa hết hạn).
 */
type ReverseOrder = { id: string; code: string; userId: string; pointsEarned: number; pointsUsed: number; pointsUsedConverted: number };
type LedgerTxn = { id: string; delta: number; expiresAt: Date | null; createdAt: Date; reason?: string; refType?: string | null; refId?: string | null };
function reverseHarness(order: ReverseOrder, opts: { reversed?: unknown; delivered?: unknown; balance?: number; ledger?: LedgerTxn[]; decCount?: number } = {}) {
  const calls: string[] = [];
  const lockSql: string[] = [];
  const queryRaw = jest.fn(async (strings: TemplateStringsArray) => {
    calls.push('lock');
    lockSql.push(strings.join('?'));
    return [{ pointsBalance: opts.balance ?? 1_000 }];
  });
  const findFirst = jest
    .fn()
    .mockImplementationOnce(async () => (calls.push('findReversed'), opts.reversed ?? null))
    .mockImplementationOnce(async () => (calls.push('findDelivered'), 'delivered' in opts ? opts.delivered : { id: 'credited' }));
  const defaultLedger: LedgerTxn[] = [
    {
      id: 'd1',
      delta: order.pointsEarned,
      expiresAt: new Date('2027-10-01T00:00:00.000Z'),
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      reason: `ORDER_DELIVERED:${order.code}`,
      refType: 'ORDER',
      refId: order.id,
    },
  ];
  const findMany = jest.fn(async () => (calls.push('loadLedger'), opts.ledger ?? defaultLedger));
  const create = jest.fn().mockResolvedValue({ id: 'ptx' });
  const update = jest.fn();
  const updateMany = jest.fn(async (_args: { where: unknown; data: unknown }) => ({ count: opts.decCount ?? 1 }));
  const tx = { $queryRaw: queryRaw, pointsTransaction: { findFirst, findMany, create }, user: { update, updateMany } };
  const txn = jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  const prisma = {
    order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
    $transaction: txn,
  } as unknown as PrismaService;
  return { prisma, txn, calls, lockSql, queryRaw, findFirst, findMany, create, update, updateMany };
}

/**
 * PF-3: dòng ORDER_REVERSED delta 0 là dấu "đã xử lý" của reverseOrderPoints (idempotency, lockedOrderPoints, tierPoints) chứ
 * không phải biến động điểm nên không được hiện trong lịch sử điểm của khách. Câu truy vấn thật được kiểm ở
 * test/integration-race/pf3-reverse-order-points.race-spec.ts.
 */
describe('LoyaltyService.getPointsTransactions (lịch sử điểm của khách)', () => {
  it('loại dòng ORDER_REVERSED delta 0, giữ mọi dòng khác (kể cả ORDER_REVERSED có số điểm), mới nhất trước, tối đa 100', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { pointsTransaction: { findMany } } as unknown as PrismaService;
    await new LoyaltyService(prisma, makeConfig()).getPointsTransactions('u1');
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', NOT: { delta: 0, reason: { startsWith: 'ORDER_REVERSED:' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
});

describe('LoyaltyService.reverseOrderPoints (idempotent)', () => {
  // reverseOrderPoints chạy ALL check + write trong 1 callback $transaction, sau khi khoá dòng user.
  const order = { id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 0, pointsUsedConverted: 0 };

  it('đã reverse rồi → idempotent, KHÔNG trừ điểm lại', async () => {
    const { prisma, txn, create, updateMany } = reverseHarness(order, { reversed: { id: 'tx-rev' } });
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    // $transaction vẫn được gọi (re-check trong tx), nhưng callback bail sớm → KHÔNG create.
    expect(txn).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('lần đầu (đã DELIVERED trước đó) → reverse điểm (transaction)', async () => {
    const { prisma, txn, create } = reverseHarness({ ...order, pointsUsed: 10 });
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    expect(txn).toHaveBeenCalledTimes(1);
    // 2 create: ORDER_REVERSED + ORDER_REFUND_POINTS
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('LoyaltyService.reverseOrderPoints chỉ trừ pointsEarned khi đã DELIVERED (B2)', () => {
  it('đơn chưa DELIVERED + pointsUsed=0 → no-op (KHÔNG trừ pointsEarned)', async () => {
    const { prisma, txn, create, updateMany } = reverseHarness(
      { id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 0, pointsUsedConverted: 0 },
      { delivered: null },
    );
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    // Tx được gọi (callback chạy) nhưng KHÔNG có ops nào → create không được call.
    expect(txn).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('đơn chưa DELIVERED nhưng pointsUsed>0 → CHỈ refund pointsUsed', async () => {
    const { prisma, txn, create, update, updateMany } = reverseHarness(
      { id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 10, pointsUsedConverted: 0 },
      { delivered: null },
    );
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    expect(txn).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.reason).toBe('ORDER_REFUND_POINTS:C1');
    expect(create.mock.calls[0][0].data.delta).toBe(10);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toEqual({ pointsBalance: { increment: 10 } });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('đơn đã DELIVERED + pointsEarned>0 + pointsUsed>0 → thu hồi đủ điểm đã tích rồi hoàn điểm đã tiêu', async () => {
    const { prisma, txn, create, update, updateMany } = reverseHarness({
      id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 10, pointsUsedConverted: 0,
    });
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    expect(txn).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].data.reason).toBe('ORDER_REFUND_POINTS:C1');
    expect(create.mock.calls[0][0].data.delta).toBe(10);
    expect(create.mock.calls[1][0].data.reason).toBe('ORDER_REVERSED:C1');
    expect(create.mock.calls[1][0].data.delta).toBe(-50);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0]![0]).toEqual({
      where: { id: 'u1', pointsBalance: { gte: 50 } },
      data: { pointsBalance: { decrement: 50 } },
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toEqual({ pointsBalance: { increment: 10 } });
  });

  it('đã ORDER_REVERSED rồi → no-op (guard re-check trong tx phát hiện và bail)', async () => {
    const { prisma, txn, create } = reverseHarness(
      { id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 10, pointsUsedConverted: 0 },
      { reversed: { id: 'rev-1' } },
    );
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    // $transaction vẫn được gọi (callback chạy + re-check) nhưng bail trước create.
    expect(txn).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * PF-3: khoá dòng user trước mọi lệnh đọc (cron hết hạn khoá dòng này rồi tính lại sổ trong tx), và chỉ thu hồi phần còn
 * lại của lô ORDER_DELIVERED. Cặp race Postgres thật nằm ở test/integration-race/pf3-reverse-order-points.race-spec.ts.
 */
describe('LoyaltyService.reverseOrderPoints khoá dòng user và thu hồi tối đa phần còn lại của lô (PF-3)', () => {
  const order = { id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 20, pointsUsed: 0, pointsUsedConverted: 0 };
  const lot = (overrides: Partial<LedgerTxn> = {}): LedgerTxn => ({
    id: 'd1',
    delta: 20,
    expiresAt: new Date('2027-10-01T00:00:00.000Z'),
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    reason: 'ORDER_DELIVERED:C1',
    refType: 'ORDER',
    refId: 'o1',
    ...overrides,
  });
  const run = (o: ReverseOrder, opts: Parameters<typeof reverseHarness>[1]) => {
    const h = reverseHarness(o, opts);
    return { h, done: new LoyaltyService(h.prisma, makeConfig()).reverseOrderPoints('o1') };
  };

  it('câu khoá FOR UPDATE chạy TRƯỚC mọi lệnh đọc sổ và lệnh ghi', async () => {
    const { h, done } = run(order, {});
    await done;
    expect(h.lockSql[0]).toMatch(/FROM "users" WHERE "id" = \? FOR UPDATE/);
    expect(h.calls).toEqual(['lock', 'findReversed', 'findDelivered', 'loadLedger']);
    expect(h.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(h.findFirst.mock.invocationCallOrder[0]!);
    expect(h.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(h.create.mock.invocationCallOrder[0]!);
  });

  it('đơn không có gì để ghi (không tích điểm, không tiêu điểm thường) → không khoá dòng user', async () => {
    const { h, done } = run({ ...order, pointsEarned: 0 }, {});
    await done;
    expect(h.queryRaw).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('chỉ đọc sổ lô STANDARD của đúng user, trong tx', async () => {
    const { h, done } = run(order, {});
    await done;
    expect(h.findMany).toHaveBeenCalledTimes(1);
    expect((h.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({ userId: 'u1', lot: 'STANDARD' });
  });

  it('lô đơn còn nguyên → thu hồi đủ pointsEarned, trừ số dư có guard gte', async () => {
    const { h, done } = run(order, { ledger: [lot()] });
    await done;
    expect(h.create.mock.calls[0][0].data).toMatchObject({ reason: 'ORDER_REVERSED:C1', delta: -20, refType: 'ORDER', refId: 'o1' });
    expect(h.updateMany.mock.calls[0]![0]).toEqual({ where: { id: 'u1', pointsBalance: { gte: 20 } }, data: { pointsBalance: { decrement: 20 } } });
  });

  it('lô đơn đã hết hạn và cron đã trừ (POINTS_EXPIRED) → không thu hồi lần hai: dòng ORDER_REVERSED delta 0, không đụng số dư', async () => {
    const expired = lot({ expiresAt: new Date('2026-12-01T00:00:00.000Z') });
    const cron: LedgerTxn = { id: 'x1', delta: -20, expiresAt: null, createdAt: new Date('2026-12-02T01:00:00.000Z'), reason: 'POINTS_EXPIRED', refType: 'EXPIRE' };
    const { h, done } = run(order, { ledger: [expired, cron], balance: 30 });
    await done;
    expect(h.create).toHaveBeenCalledTimes(1);
    const data = h.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ reason: 'ORDER_REVERSED:C1', refType: 'ORDER', refId: 'o1' });
    expect(Object.is(data.delta, 0)).toBe(true); // không phải -0
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('điểm của đơn đã tiêu bớt (còn 10/20 theo sổ lô) → chỉ thu hồi 10', async () => {
    const old: LedgerTxn = { id: 'o0', delta: 5, expiresAt: null, createdAt: new Date('2025-01-01T00:00:00.000Z'), reason: 'IT_OLD' };
    const spent: LedgerTxn = { id: 's1', delta: -15, expiresAt: null, createdAt: new Date('2026-10-05T00:00:00.000Z'), reason: 'ORDER_REDEEM:OTHER', refType: 'ORDER', refId: 'other' };
    const { h, done } = run(order, { ledger: [old, lot(), spent], balance: 10 });
    await done;
    expect(h.create.mock.calls[0][0].data.delta).toBe(-10);
    expect(h.updateMany.mock.calls[0]![0].data).toEqual({ pointsBalance: { decrement: 10 } });
  });

  it('không bao giờ vượt số dư đã đọc sau khoá (sổ lô còn 20 nhưng số dư chỉ 7)', async () => {
    const { h, done } = run(order, { ledger: [lot()], balance: 7 });
    await done;
    expect(h.create.mock.calls[0][0].data.delta).toBe(-7);
    expect(h.updateMany.mock.calls[0]![0]).toEqual({ where: { id: 'u1', pointsBalance: { gte: 7 } }, data: { pointsBalance: { decrement: 7 } } });
  });

  it('số dư âm (dữ liệu cũ) → không thu hồi gì, không làm âm thêm', async () => {
    const { h, done } = run(order, { ledger: [lot()], balance: -5 });
    await done;
    expect(Object.is(h.create.mock.calls[0][0].data.delta, 0)).toBe(true);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('dòng giao cũ thiếu refType/refId (sổ không ghép được lô) → như trước: thu hồi pointsEarned, nhưng không quá số dư', async () => {
    const legacy = lot({ refType: null, refId: null });
    const { h, done } = run(order, { ledger: [legacy], balance: 15 });
    await done;
    expect(h.create.mock.calls[0][0].data.delta).toBe(-15);
  });

  it('số dư đổi giữa chừng (guard gte không trúng) → ném để rollback, không để sổ lệch', async () => {
    const { done } = run(order, { ledger: [lot()], decCount: 0 });
    await expect(done).rejects.toThrow(/số dư đổi giữa chừng/);
  });

  it('thu hồi phần còn lại rồi vẫn hoàn điểm thường đã tiêu', async () => {
    const { h, done } = run({ ...order, pointsUsed: 40 }, { ledger: [lot({ expiresAt: new Date('2026-12-01T00:00:00.000Z') }), { id: 'x1', delta: -20, expiresAt: null, createdAt: new Date('2026-12-02T01:00:00.000Z'), reason: 'POINTS_EXPIRED' }] });
    await done;
    expect(h.create.mock.calls.map((c) => [c[0].data.reason, c[0].data.delta])).toEqual([
      ['ORDER_REFUND_POINTS:C1', 40],
      ['ORDER_REVERSED:C1', 0],
    ]);
    expect(h.update.mock.calls[0][0].data).toEqual({ pointsBalance: { increment: 40 } });
  });

  it('trần theo số dư gồm cả điểm hoàn của chính đơn: số dư 0 + hoàn 40 → thu hồi đủ 20, hoàn trước rồi mới trừ', async () => {
    const { h, done } = run({ ...order, pointsUsed: 40 }, { ledger: [lot()], balance: 0 });
    await done;
    expect(h.create.mock.calls.map((c) => [c[0].data.reason, c[0].data.delta])).toEqual([
      ['ORDER_REFUND_POINTS:C1', 40],
      ['ORDER_REVERSED:C1', -20],
    ]);
    expect(h.update.mock.invocationCallOrder[0]).toBeLessThan(h.updateMany.mock.invocationCallOrder[0]!);
    expect(h.updateMany.mock.calls[0]![0]).toEqual({ where: { id: 'u1', pointsBalance: { gte: 20 } }, data: { pointsBalance: { decrement: 20 } } });
  });

  it('điểm hoàn không đủ trang trải (số dư 3 + hoàn 5) → thu hồi 8 là tối đa, không quá số dư sau hoàn', async () => {
    const { h, done } = run({ ...order, pointsUsed: 5 }, { ledger: [lot()], balance: 3 });
    await done;
    expect(h.create.mock.calls[1][0].data.delta).toBe(-8);
  });
});

/**
 * PD-3 (spec 2.5, T10 mức unit) + review B1: phần STANDARD giữ dòng ORDER_REFUND_POINTS cũ. Phần CONVERTED
 * (tiền trả trước) KHÔNG hoàn ở đây nữa: reverseOrderPoints chạy sau khi tx huỷ đã commit, nên nếu ném lỗi thì
 * khách mất điểm vĩnh viễn. OrderReversalService.reverseFinancials hoàn nó trong tx huỷ (order-reversal.service.spec.ts).
 */
describe('LoyaltyService.reverseOrderPoints chỉ hoàn phần STANDARD (PD-3, review B1)', () => {
  const makePrisma = (order: ReverseOrder, reversed: unknown = null) => reverseHarness(order, { reversed, delivered: null });

  it('đơn tiêu 30 STANDARD + 120 CONVERTED → chỉ ORDER_REFUND_POINTS +30 (STANDARD); lô CONVERTED do reverseFinancials hoàn', async () => {
    const { prisma, create, update } = makePrisma({
      id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 0, pointsUsed: 150, pointsUsedConverted: 120,
    });
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    expect(create.mock.calls.map((c) => c[0].data)).toEqual([
      expect.objectContaining({ reason: 'ORDER_REFUND_POINTS:C1', delta: 30, lot: 'STANDARD', refType: 'ORDER', refId: 'o1' }),
    ]);
    expect(update.mock.calls.map((c) => c[0].data)).toEqual([{ pointsBalance: { increment: 30 } }]);
  });

  /**
   * OQ-15: điểm hoàn là điểm thường như mọi điểm thưởng khác, phải có hạn theo loyalty.point_expire_months.
   * Trước đây dòng hoàn ghi expiresAt NULL nên điểm khách đã tiêu rồi được hoàn sẽ sống vĩnh viễn.
   */
  describe('hạn của điểm hoàn (OQ-15)', () => {
    const NOW = new Date('2026-10-11T03:00:00.000Z');
    const configWith = (months: unknown) =>
      ({ get: async <T>(k: string, fb?: T): Promise<T> => (k === 'loyalty.point_expire_months' ? (months as T) : (fb as T)) }) as unknown as SystemConfigService;

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
      jest.setSystemTime(NOW);
    });
    afterEach(() => jest.useRealTimers());

    const order = { id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 0, pointsUsed: 40, pointsUsedConverted: 0 };

    it('ORDER_REFUND_POINTS có expiresAt = bây giờ + 12 tháng (mặc định loyalty.point_expire_months)', async () => {
      const { prisma, create } = makePrisma(order);
      await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].data).toMatchObject({
        reason: 'ORDER_REFUND_POINTS:C1',
        lot: 'STANDARD',
        delta: 40,
        expiresAt: new Date('2027-10-11T03:00:00.000Z'),
      });
    });

    it('đọc loyalty.point_expire_months từ cấu hình (6 tháng)', async () => {
      const { prisma, create } = makePrisma(order);
      await new LoyaltyService(prisma, configWith(6)).reverseOrderPoints('o1');
      expect(create.mock.calls[0][0].data.expiresAt).toEqual(new Date('2027-04-11T03:00:00.000Z'));
    });

    it.each([[0], [-3], ['abc'], [null], [Number.NaN]])('cấu hình hỏng (%p) → quay về 12 tháng, vẫn có hạn', async (bad) => {
      const { prisma, create } = makePrisma(order);
      await new LoyaltyService(prisma, configWith(bad)).reverseOrderPoints('o1');
      expect(create.mock.calls[0][0].data.expiresAt).toEqual(new Date('2027-10-11T03:00:00.000Z'));
    });

    // PE-3: thưởng vòng quay/nhiệm vụ (GameService) và điểm đánh giá (ReviewsService) gọi thẳng helper này.
    it('pointsExpiresAt công khai: tính từ `from` truyền vào (không phải bây giờ), cùng luật tháng và cấu hình hỏng → 12', async () => {
      const from = new Date('2026-10-11T03:00:00.000Z');
      jest.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
      const { prisma } = makePrisma(order);
      await expect(new LoyaltyService(prisma, configWith(6)).pointsExpiresAt(from)).resolves.toEqual(new Date('2027-04-11T03:00:00.000Z'));
      await expect(new LoyaltyService(prisma, configWith('abc')).pointsExpiresAt(from)).resolves.toEqual(new Date('2027-10-11T03:00:00.000Z'));
      expect(from).toEqual(new Date('2026-10-11T03:00:00.000Z'));
    });

    it('đơn đã giao: dòng ORDER_REVERSED (trừ) không mang hạn, chỉ dòng hoàn điểm đã tiêu mang hạn', async () => {
      const { prisma, create } = reverseHarness({ ...order, pointsEarned: 50 });
      await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
      const rows = create.mock.calls.map((c) => c[0].data);
      expect(rows.map((r) => [r.reason, r.delta, r.expiresAt ?? null])).toEqual([
        ['ORDER_REFUND_POINTS:C1', 40, new Date('2027-10-11T03:00:00.000Z')],
        ['ORDER_REVERSED:C1', -50, null],
      ]);
    });

    it('đã hoàn rồi (idempotent) → không ghi dòng nào, kể cả dòng có hạn', async () => {
      const { prisma, create } = makePrisma(order, { id: 'rev-1' });
      await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
      expect(create).not.toHaveBeenCalled();
    });
  });

  it('đơn chỉ tiêu lô CONVERTED → không ghi gì (đã hoàn trong tx huỷ), không cộng lô nào', async () => {
    const { prisma, create, update } = makePrisma({
      id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 0, pointsUsed: 50, pointsUsedConverted: 50,
    });
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('kiểm "đã đảo chưa" KHÔNG gồm ORDER_REFUND_CONVERTED (dòng đó do tx huỷ ghi trước, sẽ làm bỏ qua hoàn STANDARD và đảo pointsEarned)', async () => {
    const { prisma, findFirst } = makePrisma({
      id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 0, pointsUsed: 150, pointsUsedConverted: 120,
    });
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    const reasons: string[] = findFirst.mock.calls[0]![0].where.reason.in;
    expect(reasons).toEqual(['ORDER_REVERSED:C1', 'ORDER_REFUND_POINTS:C1']);
  });

  it('đơn đã DELIVERED + tiêu cả hai lô, tx huỷ đã hoàn CONVERTED → vẫn đảo pointsEarned và hoàn phần STANDARD', async () => {
    const { prisma, create } = reverseHarness({
      id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 150, pointsUsedConverted: 120,
    });
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    expect(create.mock.calls.map((c) => [c[0].data.reason, c[0].data.delta])).toEqual([
      ['ORDER_REFUND_POINTS:C1', 30],
      ['ORDER_REVERSED:C1', -50],
    ]);
  });
});

/**
 * Sổ PointsTransaction giả lọc ĐÚNG theo where (userId/reason.startsWith/delta.gt/createdAt.gte/
 * refId.in) — test hành vi "điểm xét hạng" theo dữ liệu, không phụ thuộc hình dạng câu truy vấn.
 */
type LedgerRow = { userId?: string; reason: string; delta: number; refId?: string | null; createdAt?: Date };
function fakeLedger(rows: LedgerRow[]) {
  const all = rows.map((r) => ({ userId: 'u1', refId: null as string | null, createdAt: new Date(), ...r }));
  type W = {
    userId?: string;
    reason?: { startsWith?: string };
    delta?: { gt?: number };
    createdAt?: { gte?: Date };
    refId?: { in?: string[] };
  };
  const match = (r: (typeof all)[number], w: W) =>
    (!w.userId || r.userId === w.userId) &&
    (!w.reason?.startsWith || r.reason.startsWith(w.reason.startsWith)) &&
    (w.delta?.gt === undefined || r.delta > w.delta.gt) &&
    (!w.createdAt?.gte || r.createdAt >= w.createdAt.gte) &&
    (!w.refId?.in || (r.refId != null && w.refId.in.includes(r.refId)));
  return {
    findMany: jest.fn(async ({ where }: { where: W }) => all.filter((r) => match(r, where))),
    aggregate: jest.fn(async ({ where }: { where: W }) => {
      const hit = all.filter((r) => match(r, where));
      return { _sum: { delta: hit.length ? hit.reduce((s, r) => s + r.delta, 0) : null } };
    }),
  };
}

describe('LoyaltyService.recalcTier (chọn hạng cao nhất đạt được)', () => {
  const TIERS = [
    { id: 'mam', sortOrder: 0, minPoints: 0, minSpending: null },
    { id: 'loc', sortOrder: 1, minPoints: 1000, minSpending: 5_000_000 },
    { id: 'dai', sortOrder: 2, minPoints: 5000, minSpending: 20_000_000 },
  ];
  function prismaFor(
    user: { pointsBalance: number; tierId: string | null },
    spent12m: number,
    earned12m?: number,
    ledgerRows?: LedgerRow[],
  ) {
    const update = jest.fn().mockResolvedValue({});
    const aggregate = jest.fn().mockResolvedValue({ _sum: { total: spent12m } });
    // Hạng xét theo điểm ĐÃ TÍCH từ đơn đã giao trong 12 tháng (sổ PointsTransaction), không phải
    // số dư còn lại — mặc định 1 dòng ORDER_DELIVERED bằng số dư để các test cũ giữ nguyên ý nghĩa.
    const pts = earned12m ?? user.pointsBalance;
    const ledger = fakeLedger(
      ledgerRows ?? (pts > 0 ? [{ reason: 'ORDER_DELIVERED:TUBU1', delta: pts, refId: 'o1' }] : []),
    );
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', ...user }), update },
      membershipTier: { findMany: jest.fn().mockResolvedValue(TIERS) },
      order: { aggregate },
      pointsTransaction: ledger,
    } as unknown as PrismaService;
    return { prisma, update, aggregate, ledger };
  }

  it('đạt hạng theo ĐIỂM → nâng lên hạng cao nhất đạt', async () => {
    const { prisma, update } = prismaFor({ pointsBalance: 5000, tierId: 'mam' }, 0);
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1');
    expect(update.mock.calls[0][0].data.tierId).toBe('dai');
  });

  it('đạt hạng theo CHI TIÊU 12 tháng (dù điểm thấp)', async () => {
    const { prisma, update } = prismaFor({ pointsBalance: 0, tierId: 'mam' }, 6_000_000);
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1');
    expect(update.mock.calls[0][0].data.tierId).toBe('loc');
  });

  // P2 (docs/2026-09-08-review-progress.md): hạng xét theo `user.pointsBalance` — tức số điểm
  // CÒN LẠI. Tiêu điểm khi thanh toán (hoặc điểm hết hạn) làm số dư tụt xuống dưới mốc →
  // sau thời gian ân hạn là bị HẠ HẠNG, mất luôn ×1,5 điểm và freeship. Dùng chính loyalty
  // currency đúng mục đích lại bị phạt. Phải xét theo điểm đã TÍCH được (12 tháng, cùng cửa
  // sổ với tiêu chí chi tiêu).
  it('tiêu điểm làm số dư tụt dưới mốc → VẪN giữ hạng (xét theo điểm đã tích, không phải số dư)', async () => {
    // Đã tích 5000 điểm trong 12 tháng, tiêu còn 100 → vẫn phải là hạng 'dai'.
    const { prisma, update } = prismaFor({ pointsBalance: 100, tierId: 'mam' }, 0, 5000);
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1');
    expect(update.mock.calls[0][0].data.tierId).toBe('dai');
  });

  it('điểm xét hạng = WHITELIST dòng ORDER_DELIVERED dương trong 12 tháng', async () => {
    const { prisma, ledger } = prismaFor({ pointsBalance: 0, tierId: 'mam' }, 0, 0);
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1');
    const where = ledger.findMany.mock.calls[0]![0].where as Record<string, unknown> & { createdAt: { gte: unknown } };
    expect(where).toMatchObject({ userId: 'u1', reason: { startsWith: 'ORDER_DELIVERED:' }, delta: { gt: 0 } });
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    // Không còn blacklist — mọi nguồn khác mặc định KHÔNG tính.
    expect(where.NOT).toBeUndefined();
  });

  // Hạng là hạng theo CHI TIÊU (minPoints = minSpending / loyalty.vnd_per_point: 500đ ↔ 5tr, …).
  // Chỉ điểm sinh từ đơn online ĐÃ GIAO mới đẩy hạng. Bản blacklist cũ vẫn đếm GAME_SPIN_WIN
  // (quay vòng quay = đổi số dư thành điểm hạng), REVIEW, SEASONPASS; và bỏ qua ORDER_REVERSED.
  it('điểm danh / POS / hoàn điểm / vòng quay / đánh giá / season pass KHÔNG tính vào điểm xét hạng', async () => {
    const { prisma, update } = prismaFor({ pointsBalance: 99_999, tierId: 'mam' }, 0, undefined, [
      { reason: 'ORDER_DELIVERED:TUBU1', delta: 300, refId: 'o1' },
      { reason: 'DAILY_CHECKIN:DAY_7', delta: 2000, refId: '2026-09-01' },
      { reason: 'POS_OFFLINE_ORDER:HD1', delta: 2000, refId: 'pos1' },
      { reason: 'ORDER_REFUND_POINTS:TUBU9', delta: 2000, refId: 'o9' },
      { reason: 'GAME_SPIN_WIN', delta: 2000 },
      { reason: 'REVIEW:ca-phe', delta: 2000, refId: 'rv1' },
      { reason: 'SEASONPASS:s1:5:FREE', delta: 2000 },
    ]);
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1');
    expect(update).not.toHaveBeenCalled(); // 300 điểm → vẫn Mầm Xanh
  });

  it('mua → giao → TRẢ HÀNG: ORDER_REVERSED của CÙNG đơn bị trừ khỏi điểm xét hạng', async () => {
    const { prisma, update, ledger } = prismaFor({ pointsBalance: 0, tierId: 'mam' }, 0, undefined, [
      { reason: 'ORDER_DELIVERED:TUBU1', delta: 6000, refId: 'o1' },
      { reason: 'ORDER_REVERSED:TUBU1', delta: -6000, refId: 'o1' },
      { reason: 'ORDER_DELIVERED:TUBU2', delta: 1200, refId: 'o2' },
    ]);
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1');
    expect(update.mock.calls[0][0].data.tierId).toBe('loc'); // 6000 − 6000 + 1200 = 1200, KHÔNG phải 'dai'
    const revWhere = (ledger.findMany.mock.calls[1] as unknown as [{ where: { refId: { in: string[] } } }])[0].where;
    expect(revWhere).toMatchObject({ userId: 'u1', reason: { startsWith: 'ORDER_REVERSED:' } });
    expect([...revWhere.refId.in].sort()).toEqual(['o1', 'o2']);
  });

  // PF-3: reverseOrderPoints chỉ thu hồi phần còn lại của lô (đã hết hạn hay đã tiêu thì ít hơn, có khi 0), nhưng đơn đã
  // trả thì chi tiêu của nó không còn thuộc hạng: loại cả đơn, không trừ theo delta của dòng thu hồi.
  it.each([[-2000], [0]])('đơn bị trả mà dòng ORDER_REVERSED chỉ thu hồi %i/6000 → vẫn bỏ NGUYÊN 6000 điểm của đơn đó', async (partial) => {
    const { prisma, update } = prismaFor({ pointsBalance: 0, tierId: 'mam' }, 0, undefined, [
      { reason: 'ORDER_DELIVERED:TUBU1', delta: 6000, refId: 'o1' },
      { reason: 'ORDER_REVERSED:TUBU1', delta: partial, refId: 'o1' },
      { reason: 'ORDER_DELIVERED:TUBU2', delta: 1200, refId: 'o2' },
    ]);
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1');
    expect(update.mock.calls[0][0].data.tierId).toBe('loc'); // chỉ còn 1200 của đơn o2
  });

  it('đơn giao TRƯỚC cửa sổ 12 tháng bị trả trong cửa sổ → không trừ nhầm (chỉ khớp đơn có dòng giao trong cửa sổ)', async () => {
    const old = new Date(Date.now() - 400 * 864e5);
    const { prisma, update } = prismaFor({ pointsBalance: 0, tierId: 'mam' }, 0, undefined, [
      { reason: 'ORDER_DELIVERED:OLD', delta: 3000, refId: 'o-old', createdAt: old },
      { reason: 'ORDER_REVERSED:OLD', delta: -3000, refId: 'o-old' },
      { reason: 'ORDER_DELIVERED:NEW', delta: 1500, refId: 'o-new' },
    ]);
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1');
    expect(update.mock.calls[0][0].data.tierId).toBe('loc'); // 1500, không phải 1500 − 3000
  });

  it('getOverview: "còn X điểm lên hạng" tính theo điểm xét hạng (whitelist), không theo số dư', async () => {
    const ledger = fakeLedger([
      { reason: 'ORDER_DELIVERED:TUBU1', delta: 300, refId: 'o1' },
      { reason: 'DAILY_CHECKIN:DAY_1', delta: 600, refId: '2026-09-01' },
      { reason: 'GAME_SPIN_WIN', delta: 500 },
    ]);
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', pointsBalance: 900, tierId: null, tier: null }),
      },
      membershipTier: { findMany: jest.fn().mockResolvedValue(TIERS) },
      pointsTransaction: ledger,
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const ov = await new LoyaltyService(prisma, makeConfig()).getOverview('u1');
    expect(ov.tierPoints).toBe(300);
    expect(ov.nextTier).toMatchObject({ id: 'loc', pointsToGo: 700 });
    expect((ledger.findMany.mock.calls[0]![0].where as { reason: unknown }).reason).toEqual({ startsWith: 'ORDER_DELIVERED:' });
  });

  // ENGAGE-21: trang Điểm Xanh phải giải thích được cách tích/đổi điểm từ chính SystemConfig, không hardcode ở FE.
  it('getOverview: trả tỷ lệ tích/đổi điểm từ SystemConfig và mốc chi tiêu của từng hạng', async () => {
    const values: Record<string, number> = {
      'loyalty.vnd_per_point': 12_000,
      'loyalty.vnd_per_point_redeem': 1000,
      'loyalty.max_redeem_pct': 0.3,
    };
    const config = { get: async <T>(k: string, fb?: T): Promise<T> => (values[k] ?? fb) as T } as unknown as SystemConfigService;
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', pointsBalance: 0, tierId: null, tier: null }) },
      membershipTier: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'mam', name: 'Mầm Xanh', sortOrder: 0, minPoints: 0, minSpending: null, pointMultiplier: 1 },
          { id: 'loc', name: 'Lộc Biếc', sortOrder: 1, minPoints: 500, minSpending: 5_000_000, pointMultiplier: 1.2 },
        ]),
      },
      pointsTransaction: fakeLedger([]),
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const ov = await new LoyaltyService(prisma, config).getOverview('u1');
    expect(ov.rates).toEqual({ vndPerPoint: 12_000, vndPerPointRedeem: 1000, maxRedeemPct: 0.3 });
    expect(ov.tiers.map((t) => t.minSpending)).toEqual([null, 5_000_000]);
    expect(ov.nextTier).toMatchObject({ id: 'loc', minSpending: 5_000_000 });
  });

  it('getOverview: SystemConfig sai kiểu → tỷ lệ rơi về mặc định (10.000đ/điểm, 1.000đ/điểm, 20%)', async () => {
    const config = { get: async <T>(_k: string, _fb?: T): Promise<T> => 'oops' as unknown as T } as unknown as SystemConfigService;
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', pointsBalance: 0, tierId: null, tier: null }) },
      membershipTier: { findMany: jest.fn().mockResolvedValue(TIERS) },
      pointsTransaction: fakeLedger([]),
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const ov = await new LoyaltyService(prisma, config).getOverview('u1');
    expect(ov.rates).toEqual({ vndPerPoint: 10_000, vndPerPointRedeem: 1000, maxRedeemPct: 0.2 });
  });

  it('PD-3 getOverview: trả pointsConvertedBalance, pointsTotal, redeemableTotal; redeemablePoints giữ nghĩa lô STANDARD dùng được', async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', pointsBalance: 900, pointsConvertedBalance: 124, tierId: null, tier: null }),
      },
      membershipTier: { findMany: jest.fn().mockResolvedValue(TIERS) },
      pointsTransaction: fakeLedger([]),
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const ov = await new LoyaltyService(prisma, makeConfig()).getOverview('u1');
    expect(ov).toMatchObject({
      pointsBalance: 900,
      pointsConvertedBalance: 124,
      pointsTotal: 1024,
      redeemablePoints: 900,
      redeemableTotal: 1024,
      tierPoints: 0,
    });
  });

  // PD-3 T12: điểm quy đổi từ xu (tiền trả trước) không phải mua hàng, không đẩy hạng (Q-09).
  it('T12: 5.000 điểm quy đổi (XU_TO_POINTS, lô CONVERTED) + 0 đơn → vẫn hạng nền', async () => {
    const { prisma, update } = prismaFor({ pointsBalance: 0, tierId: 'mam' }, 0, undefined, [
      { reason: 'XU_TO_POINTS:5000000', delta: 5000, refId: 'u1' },
      { reason: 'ORDER_REFUND_CONVERTED:TUBU1', delta: 2000, refId: 'o1' },
      { reason: 'ORDER_REFUND_XU:TUBU2', delta: 2000, refId: 'o2' },
    ]);
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', pointsBalance: 0, pointsConvertedBalance: 9000, tierId: 'mam' });
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1');
    expect(update).not.toHaveBeenCalled();
  });

  it('T12: chi tiêu 12 tháng cộng orders.total (đã trừ phần trả bằng điểm) → đơn trả hết bằng điểm quy đổi không tăng chi tiêu', async () => {
    const { prisma, aggregate } = prismaFor({ pointsBalance: 0, tierId: 'mam' }, 0);
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1');
    expect(aggregate.mock.calls[0][0]._sum).toEqual({ total: true });
  });

  it('đã đúng hạng → không update', async () => {
    const { prisma, update } = prismaFor({ pointsBalance: 0, tierId: 'mam' }, 0);
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1');
    expect(update).not.toHaveBeenCalled();
  });

  it('mặc định: chi tiêu lên hạng LOẠI TRỪ đơn trả bằng XU (chống lên hạng rẻ bằng xu)', async () => {
    const { prisma, aggregate } = prismaFor({ pointsBalance: 0, tierId: 'mam' }, 0);
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1');
    expect(aggregate.mock.calls[0][0].where).toMatchObject({
      status: 'DELIVERED',
      paymentMethod: { not: 'XU' },
    });
  });

  it('config loyalty.earn_points_on_xu=true → KHÔNG loại trừ XU khỏi chi tiêu lên hạng', async () => {
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> => (k === 'loyalty.earn_points_on_xu' ? (true as T) : (fb as T)),
    } as unknown as SystemConfigService;
    const { prisma, aggregate } = prismaFor({ pointsBalance: 0, tierId: 'mam' }, 0);
    await new LoyaltyService(prisma, cfg).recalcTier('u1');
    expect(aggregate.mock.calls[0][0].where.paymentMethod).toBeUndefined();
  });

  it('preloadedTiers truyền vào → KHÔNG tự findMany lại (dùng cho batch recalcAllTiers)', async () => {
    const { prisma, update } = prismaFor({ pointsBalance: 5000, tierId: 'mam' }, 0);
    const findMany = (prisma as unknown as { membershipTier: { findMany: jest.Mock } }).membershipTier.findMany;
    await new LoyaltyService(prisma, makeConfig()).recalcTier('u1', TIERS as unknown as MembershipTier[]);
    expect(findMany).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0].data.tierId).toBe('dai');
  });
});

describe('LoyaltyService.recalcAllTiers (tránh N+1)', () => {
  it('load membershipTier.findMany ĐÚNG 1 LẦN cho cả batch, không phải mỗi user 1 lần', async () => {
    const users = [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }];
    const findMany = jest.fn().mockResolvedValue([{ id: 'mam', sortOrder: 0, minPoints: 0, minSpending: null }]);
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue(users),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', pointsBalance: 0, tierId: 'mam' }),
        update: jest.fn(),
      },
      membershipTier: { findMany },
      order: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: 0 } }) },
    } as unknown as PrismaService;

    const n = await new LoyaltyService(prisma, makeConfig()).recalcAllTiers();
    expect(n).toBe(3);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe('LoyaltyService.dailyCheckIn — Task 9 analytics (engagement_action)', () => {
  function makeAnalytics() {
    return {
      record: jest.fn().mockResolvedValue(undefined),
      recordBestEffort: jest.fn().mockResolvedValue(undefined),
    };
  }

  /**
   * analytics là @Optional() ở LoyaltyService (loyalty-features.spec.ts dựng LoyaltyService 2
   * tham số ở rất nhiều test không liên quan tới dailyCheckIn — không sửa hàng loạt test đó,
   * ngoài phạm vi Task 9). Test này wiring mock THẬT để chứng minh record(tx,...) được gọi đúng
   * — dựng tx RIÊNG (khác instance với prisma top-level) để assert tx-identity (lesson (b)).
   */
  it('điểm danh thành công (lần đầu) → record(tx,...) đúng eventName/props, dùng ĐÚNG tx (khác instance prisma top-level)', async () => {
    const tx = {
      loyaltyCheckIn: { create: jest.fn().mockResolvedValue({}) },
      pointsTransaction: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({ pointsBalance: 101 }), findUniqueOrThrow: jest.fn() },
    };
    const prisma = {
      loyaltyCheckIn: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const analytics = makeAnalytics();
    const svc = new LoyaltyService(prisma, makeConfig(), analytics as unknown as AnalyticsEventsService);

    const r = await svc.dailyCheckIn('u1');

    expect(tx).not.toBe(prisma); // tx RIÊNG, không phải cùng instance với prisma top-level
    expect(analytics.record).toHaveBeenCalledTimes(1);
    expect(analytics.record).toHaveBeenCalledWith(tx, {
      eventName: 'engagement_action',
      userId: 'u1',
      platform: 'miniapp',
      props: { action: 'loyalty_checkin', cycleDay: 1, streakDays: 1, pointsEarned: 1 },
    });
    expect(r).toMatchObject({ success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1 });
  });

  it('đã điểm danh hôm nay → BadRequest TRƯỚC khi vào transaction, KHÔNG gọi analytics', async () => {
    const analytics = makeAnalytics();
    const prisma = {
      loyaltyCheckIn: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const svc = new LoyaltyService(prisma, makeConfig(), analytics as unknown as AnalyticsEventsService);
    const today = vnDateKey();
    (prisma.loyaltyCheckIn.findFirst as jest.Mock).mockResolvedValue({ dayKey: today });

    await expect(svc.dailyCheckIn('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(analytics.record).not.toHaveBeenCalled();
  });

  it('KHÔNG wiring analytics (undefined, giống các test loyalty-features.spec.ts khác) → dailyCheckIn vẫn chạy bình thường, không throw', async () => {
    const tx = {
      loyaltyCheckIn: { create: jest.fn().mockResolvedValue({}) },
      pointsTransaction: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({ pointsBalance: 1 }), findUniqueOrThrow: jest.fn() },
    };
    const prisma = {
      loyaltyCheckIn: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const svc = new LoyaltyService(prisma, makeConfig()); // KHÔNG truyền analytics — @Optional()
    await expect(svc.dailyCheckIn('u1')).resolves.toMatchObject({ success: true });
  });
});
