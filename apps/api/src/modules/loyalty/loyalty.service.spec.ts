import { MembershipTier, Prisma } from '@prisma/client';
import { LoyaltyService } from './loyalty.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

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
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'me', tierId: 't1' }) },
      coupon: { findMany: jest.fn().mockResolvedValue(coupons) },
      couponRedemption: { groupBy: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    const svc = new LoyaltyService(prisma, makeConfig());
    const result = await svc.getAvailableCoupons('me');
    const codes = result.map((c) => c.code).sort();

    expect(codes).toEqual(['MINE', 'PUB', 'TIER_OK']);
  });

  it('ẩn coupon đã dùng hết lượt cá nhân (perUserLimit)', async () => {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'me', tierId: null }) },
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
      pointsTransaction: { findFirst: jest.fn().mockResolvedValue(existed), create: jest.fn() },
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
      pointsTransaction: { findFirst, create: jest.fn() },
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
      pointsTransaction: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      $transaction: jest.fn().mockRejectedValue(p2002),
    } as unknown as PrismaService;

    await expect(
      new LoyaltyService(prisma, makeConfig()).creditOrderPoints('o1'),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

describe('LoyaltyService.reverseOrderPoints (idempotent)', () => {
  // reverseOrderPoints giờ chạy ALL check + write trong 1 callback $transaction.
  // findFirst/create/update đều trên tx — mock $transaction để invoke callback với tx mock.
  function prismaFor(
    order: unknown,
    alreadyReversed: unknown = null,
    deliveredTx: unknown = { id: 'tx-credited' },
  ) {
    const txFindFirst = jest
      .fn()
      .mockResolvedValueOnce(alreadyReversed)
      .mockResolvedValueOnce(deliveredTx);
    const txCreate = jest.fn();
    const txUpdate = jest.fn();
    const tx = {
      pointsTransaction: { findFirst: txFindFirst, create: txCreate },
      user: { update: txUpdate },
    };
    const txn = jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
    const prisma = {
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      $transaction: txn,
    } as unknown as PrismaService;
    return { prisma, txn, txFindFirst, txCreate, txUpdate };
  }

  it('đã reverse rồi → idempotent, KHÔNG trừ điểm lại', async () => {
    const { prisma, txn, txCreate } = prismaFor(
      { id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 0 },
      { id: 'tx-rev' },
    );
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    // $transaction vẫn được gọi (re-check trong tx), nhưng callback bail sớm → KHÔNG create.
    expect(txn).toHaveBeenCalledTimes(1);
    expect(txCreate).not.toHaveBeenCalled();
  });

  it('lần đầu (đã DELIVERED trước đó) → reverse điểm (transaction)', async () => {
    const { prisma, txn, txCreate } = prismaFor({
      id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 10,
    });
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    expect(txn).toHaveBeenCalledTimes(1);
    // 2 create: ORDER_REVERSED + ORDER_REFUND_POINTS
    expect(txCreate).toHaveBeenCalledTimes(2);
  });
});

describe('LoyaltyService.reverseOrderPoints chỉ trừ pointsEarned khi đã DELIVERED (B2)', () => {
  function makePrisma(
    order: unknown,
    opts: { reversed?: unknown; delivered?: unknown } = {},
  ) {
    const txFindFirst = jest
      .fn()
      .mockResolvedValueOnce(opts.reversed ?? null)
      .mockResolvedValueOnce(opts.delivered ?? null);
    const create = jest.fn();
    const update = jest.fn();
    const tx = {
      pointsTransaction: { findFirst: txFindFirst, create },
      user: { update },
    };
    const txn = jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
    const prisma = {
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      $transaction: txn,
    } as unknown as PrismaService;
    return { prisma, txn, create, update };
  }

  it('đơn chưa DELIVERED + pointsUsed=0 → no-op (KHÔNG trừ pointsEarned)', async () => {
    const { prisma, txn, create } = makePrisma(
      { id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 0 },
      { reversed: null, delivered: null },
    );
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    // Tx được gọi (callback chạy) nhưng KHÔNG có ops nào → create không được call.
    expect(txn).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('đơn chưa DELIVERED nhưng pointsUsed>0 → CHỈ refund pointsUsed', async () => {
    const { prisma, txn, create, update } = makePrisma(
      { id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 10 },
      { reversed: null, delivered: null },
    );
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    expect(txn).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.reason).toBe('ORDER_REFUND_POINTS:C1');
    expect(create.mock.calls[0][0].data.delta).toBe(10);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toEqual({ pointsBalance: { increment: 10 } });
  });

  it('đơn đã DELIVERED + pointsEarned>0 + pointsUsed>0 → reverse đầy đủ 4 ops', async () => {
    const { prisma, txn, create, update } = makePrisma(
      { id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 10 },
      { reversed: null, delivered: { id: 'tx-credited' } },
    );
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    expect(txn).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].data.reason).toBe('ORDER_REVERSED:C1');
    expect(create.mock.calls[0][0].data.delta).toBe(-50);
    expect(create.mock.calls[1][0].data.reason).toBe('ORDER_REFUND_POINTS:C1');
    expect(create.mock.calls[1][0].data.delta).toBe(10);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][0].data).toEqual({ pointsBalance: { decrement: 50 } });
    expect(update.mock.calls[1][0].data).toEqual({ pointsBalance: { increment: 10 } });
  });

  it('đã ORDER_REVERSED rồi → no-op (guard re-check trong tx phát hiện và bail)', async () => {
    const { prisma, txn, create } = makePrisma(
      { id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 10 },
      { reversed: { id: 'rev-1' }, delivered: { id: 'tx-credited' } },
    );
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    // $transaction vẫn được gọi (callback chạy + re-check) nhưng bail trước create.
    expect(txn).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('LoyaltyService.recalcTier (chọn hạng cao nhất đạt được)', () => {
  const TIERS = [
    { id: 'mam', sortOrder: 0, minPoints: 0, minSpending: null },
    { id: 'loc', sortOrder: 1, minPoints: 1000, minSpending: 5_000_000 },
    { id: 'dai', sortOrder: 2, minPoints: 5000, minSpending: 20_000_000 },
  ];
  function prismaFor(user: { pointsBalance: number; tierId: string | null }, spent12m: number) {
    const update = jest.fn().mockResolvedValue({});
    const aggregate = jest.fn().mockResolvedValue({ _sum: { total: spent12m } });
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', ...user }), update },
      membershipTier: { findMany: jest.fn().mockResolvedValue(TIERS) },
      order: { aggregate },
    } as unknown as PrismaService;
    return { prisma, update, aggregate };
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
