import { LoyaltyService } from './loyalty.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { queryRounds } from '../../common/query-rounds.testing';

const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;

const TIERS = [
  { id: 'mam', name: 'Mầm Xanh', sortOrder: 0, minPoints: 0, minSpending: null, pointMultiplier: 1 },
  { id: 'loc', name: 'Lộc Biếc', sortOrder: 1, minPoints: 30_000, minSpending: 1_500_000, pointMultiplier: 1.2 },
];
const USER = { id: 'u1', pointsBalance: 900, pointsConvertedBalance: 50, pointsMarketplaceBalance: 120, tierId: 'mam', tier: TIERS[0], tierGraceUntil: null };
const LEDGER = [
  { reason: 'ORDER_DELIVERED:TUBU1', delta: 300, refId: 'o1', createdAt: new Date('2026-10-01T00:00:00Z'), expiresAt: new Date('2027-10-01T00:00:00Z'), lot: 'STANDARD' },
];

type Wrap = <A extends unknown[], T>(f: (...a: A) => T | Promise<T>) => (...a: A) => Promise<T>;
const direct: Wrap = (f) => async (...a) => f(...a);

/** Prisma giả: mỗi lời gọi đi qua `wrap` (thẳng, hoặc `db` của queryRounds để đếm vòng). */
function prismaWith(wrap: Wrap) {
  return {
    user: { findUniqueOrThrow: wrap(async () => USER) },
    membershipTier: { findMany: wrap(async () => TIERS) },
    order: { aggregate: wrap(async () => ({ _sum: { total: 600_000 } })), findMany: wrap(async () => []) },
    returnRequest: { findMany: wrap(async () => []) },
    externalPointsClaim: { findMany: wrap(async () => []) },
    pointsTransaction: {
      // Khách thường: có điểm từ đơn đã giao (một đơn đã trả), chưa có đơn chat/điện thoại.
      findMany: wrap(async ({ where }: { where: { reason?: { startsWith?: string }; lot?: string } }) => {
        const prefix = where.reason?.startsWith;
        if (prefix === 'ORDER_DELIVERED:') return LEDGER;
        if (prefix === 'ORDER_REVERSED:') return [{ refId: 'o1' }];
        if (prefix) return [];
        return where.lot === 'STANDARD' ? LEDGER : [];
      }),
      aggregate: wrap(async () => ({ _sum: { delta: 300 } })),
    },
    $queryRaw: wrap(async () => []),
  } as unknown as PrismaService;
}

describe('LoyaltyService.getOverview: số vòng chờ DB (GET /me/loyalty)', () => {
  it('đọc song song: tối đa 3 vòng nối tiếp (trước đây 9 trên DB đo) và không quá 4 lời gọi cùng lúc', async () => {
    const { db, run } = queryRounds();
    const { rounds, maxParallel, value } = await run(() => new LoyaltyService(prismaWith(db), config).getOverview('u1'));
    expect(rounds).toBeLessThanOrEqual(3);
    expect(maxParallel).toBeLessThanOrEqual(4);
    expect(value).toEqual(await new LoyaltyService(prismaWith(direct), config).getOverview('u1'));
  });

  it('khách không tồn tại: vẫn báo lỗi của findUniqueOrThrow', async () => {
    const prisma = prismaWith(direct) as unknown as { user: { findUniqueOrThrow: () => Promise<never> } };
    prisma.user.findUniqueOrThrow = async () => {
      throw new Error('No User found');
    };
    await expect(new LoyaltyService(prisma as unknown as PrismaService, config).getOverview('u1')).rejects.toThrow('No User found');
  });
});

describe('LoyaltyService.getAvailableCoupons: số vòng chờ DB (GET /me/coupons)', () => {
  const future = new Date(Date.now() + 864e5);
  const COUPONS = [
    { id: 'PUB', code: 'PUB', scope: 'PUBLIC', scopeMeta: null, type: 'AMOUNT', value: 10_000, minOrder: null, maxDiscount: null, endAt: future, perUserLimit: 1, isActive: true, newCustomerOnly: false, applyTo: null },
    { id: 'CLM', code: 'CLM', scope: 'CLAIM', scopeMeta: null, type: 'AMOUNT', value: 20_000, minOrder: null, maxDiscount: null, endAt: future, perUserLimit: 2, isActive: true, newCustomerOnly: false, applyTo: null },
    { id: 'USED', code: 'USED', scope: 'PUBLIC', scopeMeta: null, type: 'AMOUNT', value: 5_000, minOrder: null, maxDiscount: null, endAt: future, perUserLimit: 1, isActive: true, newCustomerOnly: false, applyTo: null },
  ];
  function couponPrisma(wrap: Wrap) {
    return {
      user: { findUniqueOrThrow: wrap(async () => ({ id: 'u1', tierId: null, zaloId: 'z1', phone: '0901234567', role: 'CUSTOMER' })) },
      $queryRaw: wrap(async () => COUPONS.map((c) => ({ id: c.id }))),
      coupon: { findMany: wrap(async () => COUPONS) },
      couponClaim: { findMany: wrap(async () => [{ couponId: 'CLM' }]) },
      couponRedemption: { groupBy: wrap(async () => [{ couponId: 'USED', _count: { _all: 1 } }, { couponId: 'CLM', _count: { _all: 1 } }]) },
    } as unknown as PrismaService;
  }

  it('lượt nhận và lượt dùng đọc cùng lúc: 4 vòng (trước đây 5), kết quả như đọc thẳng', async () => {
    const { db, run } = queryRounds();
    const { rounds, maxParallel, value } = await run(() => new LoyaltyService(couponPrisma(db), config).getAvailableCoupons('u1'));
    expect(rounds).toBe(4);
    expect(maxParallel).toBeLessThanOrEqual(4);
    expect(value.map((c) => c.code).sort()).toEqual(['CLM', 'PUB']);
    expect(value).toEqual(await new LoyaltyService(couponPrisma(direct), config).getAvailableCoupons('u1'));
  });
});
