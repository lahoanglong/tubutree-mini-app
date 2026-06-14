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
  it('lọc đúng scope: PUBLIC + USER_GROUP(của mình) + TIER(khớp); ẩn của user khác / tier khác / INVITE', async () => {
    const coupons = [
      coupon('PUB', 'PUBLIC', null),
      coupon('MINE', 'USER_GROUP', { userId: 'me' }),
      coupon('OTHER', 'USER_GROUP', { userId: 'someone-else' }),
      coupon('TIER_OK', 'TIER', { tierId: 't1' }),
      coupon('TIER_NO', 'TIER', { tierId: 't2' }),
      coupon('INVITE', 'INVITE', null),
    ];
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'me', tierId: 't1' }) },
      coupon: { findMany: jest.fn().mockResolvedValue(coupons) },
      couponRedemption: { count: jest.fn().mockResolvedValue(0) },
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
      couponRedemption: { count: jest.fn().mockResolvedValue(1) }, // đã dùng 1 = perUserLimit
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
});

describe('LoyaltyService.reverseOrderPoints (idempotent)', () => {
  function prismaFor(order: unknown, alreadyReversed: unknown = null) {
    const txn = jest.fn().mockResolvedValue([]);
    const prisma = {
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      pointsTransaction: { findFirst: jest.fn().mockResolvedValue(alreadyReversed), create: jest.fn() },
      user: { update: jest.fn() },
      $transaction: txn,
    } as unknown as PrismaService;
    return { prisma, txn };
  }

  it('đã reverse rồi → idempotent, KHÔNG trừ điểm lại', async () => {
    const { prisma, txn } = prismaFor(
      { id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 0 },
      { id: 'tx-rev' },
    );
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    expect(txn).not.toHaveBeenCalled();
  });

  it('lần đầu → reverse điểm (transaction)', async () => {
    const { prisma, txn } = prismaFor({ id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50, pointsUsed: 10 });
    await new LoyaltyService(prisma, makeConfig()).reverseOrderPoints('o1');
    expect(txn).toHaveBeenCalledTimes(1);
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
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', ...user }), update },
      membershipTier: { findMany: jest.fn().mockResolvedValue(TIERS) },
      order: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: spent12m } }) },
    } as unknown as PrismaService;
    return { prisma, update };
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
});
