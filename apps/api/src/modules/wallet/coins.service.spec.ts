import { CoinsService } from './coins.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T, // default: thưởng 5000 xu
} as unknown as SystemConfigService;

describe('CoinsService.spendCoins', () => {
  function spendPrisma(decCount = 1) {
    const updateMany = jest.fn().mockResolvedValue({ count: decCount });
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      user: { updateMany },
      coinTransaction: { create },
      $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma)),
    } as unknown as PrismaService;
    return { prisma, updateMany, create };
  }

  it('đủ xu → trừ atomic (gte) + ghi CoinTransaction âm', async () => {
    const { prisma, updateMany, create } = spendPrisma();
    await new CoinsService(prisma, config).spendCoins('u1', 5000, 'GAME_BUY_SEEDS', 'GAME');
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'u1', coinsBalance: { gte: 5000 } },
      data: { coinsBalance: { decrement: 5000 } },
    });
    expect(create.mock.calls[0][0].data).toMatchObject({ userId: 'u1', delta: -5000, reason: 'GAME_BUY_SEEDS', refType: 'GAME' });
  });

  it('không đủ xu (count 0) → throw', async () => {
    const { prisma } = spendPrisma(0);
    await expect(new CoinsService(prisma, config).spendCoins('u1', 5000, 'GAME_BUY_SEEDS', 'GAME')).rejects.toThrow('Không đủ TubuXu');
  });

  it('amount <= 0 → throw', async () => {
    const { prisma } = spendPrisma();
    await expect(new CoinsService(prisma, config).spendCoins('u1', 0, 'X', 'GAME')).rejects.toThrow();
  });

  it('truyền tx → dùng chính tx, KHÔNG mở $transaction mới', async () => {
    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      coinTransaction: { create: jest.fn().mockResolvedValue({}) },
    };
    const { prisma } = spendPrisma();
    await new CoinsService(prisma, config).spendCoins('u1', 100, 'ORDER_PAY:C1', 'ORDER', 'o1', tx as never);
    expect(tx.user.updateMany).toHaveBeenCalled();
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).not.toHaveBeenCalled();
  });
});

describe('CoinsService.grantCoins (idempotent)', () => {
  function grantPrisma(insertedCount = 1) {
    const createMany = jest.fn().mockResolvedValue({ count: insertedCount });
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      coinTransaction: { createMany },
      user: { update },
      $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma)),
    } as unknown as PrismaService;
    return { prisma, createMany, update };
  }

  it('hợp lệ → INSERT ON CONFLICT DO NOTHING + cộng coinsBalance cùng tx', async () => {
    const { prisma, createMany, update } = grantPrisma(1);
    await new CoinsService(prisma, config).grantCoins('u1', 5000, 'CONVERT_FROM_WALLET', 'CONVERT');
    expect(createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', delta: 5000, reason: 'CONVERT_FROM_WALLET', refType: 'CONVERT', refId: undefined }],
      skipDuplicates: true,
    });
    expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { coinsBalance: { increment: 5000 } } });
  });

  it('trùng reason REFERRAL (INSERT bỏ qua, count=0) → no-op, KHÔNG cộng số dư, không throw', async () => {
    const { prisma, update } = grantPrisma(0);
    await expect(
      new CoinsService(prisma, config).grantCoins('u1', 5000, 'REFERRAL_CASHBACK:r1', 'REFERRAL', 'r1'),
    ).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('truyền tx + trùng → không phát sinh lỗi trong tx của caller, không mở $transaction mới', async () => {
    const { prisma } = grantPrisma();
    const tx = {
      coinTransaction: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: { update: jest.fn() },
    };
    await new CoinsService(prisma, config).grantCoins('u1', 200, 'COMMUNITY_POST:p1', 'COMMUNITY', 'p1', tx as never);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).not.toHaveBeenCalled();
  });

  it('amount <= 0 → no-op (không mở transaction)', async () => {
    const prisma = { $transaction: jest.fn() } as unknown as PrismaService;
    await new CoinsService(prisma, config).grantCoins('u1', 0, 'X');
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).not.toHaveBeenCalled();
  });
});

/** count() theo tiền tố reason — mô phỏng số dòng thưởng/thu hồi giới thiệu của người mời. */
function countByPrefix(byPrefix: Record<string, number>) {
  return jest
    .fn()
    .mockImplementation(async ({ where }: { where: { reason: { startsWith: string } } }) => byPrefix[where.reason.startsWith] ?? 0);
}

describe('CoinsService.grantReferralOrderReward (Q-05: thưởng người mời theo đơn thứ 2)', () => {
  const DAY = 864e5;
  function refPrisma(opts: {
    referredById: string | null;
    referrerRole?: string;
    orders?: { id: string; createdAt: Date }[];
    already?: unknown;
    inserted?: number;
    count?: jest.Mock;
  }) {
    const createMany = jest.fn().mockResolvedValue({ count: opts.inserted ?? 1 });
    const userUpdate = jest.fn().mockResolvedValue({});
    const findUnique = jest
      .fn()
      .mockImplementation(async ({ where }: { where: { id: string } }) =>
        where.id === 'referee1' ? { referredById: opts.referredById } : { role: opts.referrerRole ?? 'CUSTOMER' },
      );
    const prisma = {
      user: { findUnique, update: userUpdate },
      order: { findMany: jest.fn().mockResolvedValue(opts.orders ?? []) },
      coinTransaction: {
        createMany,
        findFirst: jest.fn().mockResolvedValue(opts.already ?? null),
        count: opts.count ?? jest.fn().mockResolvedValue(0),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma)),
    } as unknown as PrismaService;
    return { prisma, createMany, userUpdate };
  }
  const twoOrders = (gapDays: number) => [
    { id: 'o1', createdAt: new Date(Date.now() - (gapDays + 1) * DAY) },
    { id: 'o2', createdAt: new Date(Date.now() - DAY) },
  ];

  it('referee không có người giới thiệu → không thưởng', async () => {
    const { prisma, createMany } = refPrisma({ referredById: null, orders: twoOrders(5) });
    expect(await new CoinsService(prisma, config).grantReferralOrderReward('referee1')).toBe(false);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('referredById trỏ chính mình → bỏ qua', async () => {
    const { prisma, createMany } = refPrisma({ referredById: 'referee1', orders: twoOrders(5) });
    expect(await new CoinsService(prisma, config).grantReferralOrderReward('referee1')).toBe(false);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('người mời là CTV → không thưởng xu (CTV chỉ hưởng hoa hồng)', async () => {
    const { prisma, createMany } = refPrisma({ referredById: 'referrer1', referrerRole: 'AFFILIATE', orders: twoOrders(5) });
    expect(await new CoinsService(prisma, config).grantReferralOrderReward('referee1')).toBe(false);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('mới 1 đơn giao xong → chưa thưởng', async () => {
    const { prisma, createMany } = refPrisma({ referredById: 'referrer1', orders: twoOrders(5).slice(0, 1) });
    expect(await new CoinsService(prisma, config).grantReferralOrderReward('referee1')).toBe(false);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('đơn thứ 2 cách đơn đầu > 30 ngày → không thưởng', async () => {
    const { prisma, createMany } = refPrisma({ referredById: 'referrer1', orders: twoOrders(31) });
    expect(await new CoinsService(prisma, config).grantReferralOrderReward('referee1')).toBe(false);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('đã thưởng (dòng mới hoặc kiểu cũ qua cashback) → không thưởng lại', async () => {
    const { prisma, createMany } = refPrisma({ referredById: 'referrer1', orders: twoOrders(5), already: { id: 'x' } });
    expect(await new CoinsService(prisma, config).grantReferralOrderReward('referee1')).toBe(false);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('đơn thứ 2 trong 30 ngày → chỉ người mời +5000, reason/refId đúng, người được mời không nhận xu', async () => {
    const { prisma, createMany, userUpdate } = refPrisma({ referredById: 'referrer1', orders: twoOrders(10) });
    expect(await new CoinsService(prisma, config).grantReferralOrderReward('referee1')).toBe(true);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0][0]).toMatchObject({
      skipDuplicates: true,
      data: [{ userId: 'referrer1', delta: 5000, reason: 'REFERRAL_ORDER2:referee1', refType: 'REFERRAL', refId: 'o1:o2' }],
    });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'referrer1' }, data: { coinsBalance: { increment: 5000 } } });
  });

  it('thua race (ON CONFLICT không ghi dòng nào) → không cộng số dư', async () => {
    const { prisma, userUpdate } = refPrisma({ referredById: 'referrer1', orders: twoOrders(10), inserted: 0 });
    expect(await new CoinsService(prisma, config).grantReferralOrderReward('referee1')).toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  describe('mốc thưởng thêm', () => {
    const milestones = [
      { count: 3, bonus: 20000 },
      { count: 5, bonus: 40000 },
    ];
    const milestoneConfig = {
      get: jest.fn().mockImplementation(async (key: string, fb?: unknown) => (key === 'coins.referral_milestones' ? milestones : fb)),
    } as unknown as SystemConfigService;

    it('3 thưởng còn hiệu lực (2 mới + 1 kiểu cũ) → thưởng mốc 3', async () => {
      const count = countByPrefix({ 'REFERRAL_CASHBACK:': 1, 'REFERRAL_ORDER2:': 2 });
      const { prisma, createMany } = refPrisma({ referredById: 'referrer1', orders: twoOrders(10), count });
      await new CoinsService(prisma, milestoneConfig).grantReferralOrderReward('referee1');
      const reasons = createMany.mock.calls.map((c) => c[0].data[0].reason);
      expect(reasons).toContain('REFERRAL_MILESTONE:referrer1:3');
      expect(reasons).not.toContain('REFERRAL_MILESTONE:referrer1:5');
    });

    it('lượt đã bị thu hồi không được tính vào mốc', async () => {
      const count = countByPrefix({ 'REFERRAL_ORDER2:': 3, 'REFERRAL_ORDER2_REVOKE:': 1 });
      const { prisma, createMany } = refPrisma({ referredById: 'referrer1', orders: twoOrders(10), count });
      await new CoinsService(prisma, milestoneConfig).grantReferralOrderReward('referee1');
      const reasons = createMany.mock.calls.map((c) => c[0].data[0].reason);
      expect(reasons.some((r) => r.startsWith('REFERRAL_MILESTONE:'))).toBe(false);
    });
  });
});

describe('CoinsService.getOverview → tiến độ mốc giới thiệu', () => {
  const milestones = [
    { count: 3, bonus: 20000 },
    { count: 5, bonus: 40000 },
    { count: 10, bonus: 100000 },
  ];

  function milestoneConfig(value: unknown) {
    return {
      get: jest.fn().mockImplementation(async (key: string, fb?: unknown) => (key === 'coins.referral_milestones' ? value : fb)),
    } as unknown as SystemConfigService;
  }

  function overviewPrisma(successCount: number) {
    return {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ coinsBalance: 1000, referralCode: 'ABC123' }) },
      coinTransaction: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { delta: 0 } }),
        count: countByPrefix({ 'REFERRAL_ORDER2:': successCount }),
      },
    } as unknown as PrismaService;
  }

  it('chưa đạt mốc nào → nextMilestone là mốc nhỏ nhất', async () => {
    const result = await new CoinsService(overviewPrisma(1), milestoneConfig(milestones)).getOverview('u1');
    expect(result.referralMilestones).toEqual(milestones);
    expect(result.nextMilestone).toEqual({ count: 3, bonus: 20000 });
  });

  it('đã đạt mốc 3 → nextMilestone là mốc 5', async () => {
    const result = await new CoinsService(overviewPrisma(3), milestoneConfig(milestones)).getOverview('u1');
    expect(result.nextMilestone).toEqual({ count: 5, bonus: 40000 });
  });

  it('vượt mọi mốc → nextMilestone null', async () => {
    const result = await new CoinsService(overviewPrisma(10), milestoneConfig(milestones)).getOverview('u1');
    expect(result.nextMilestone).toBeNull();
  });

  it('không cấu hình mốc (config mặc định) → referralMilestones rỗng, nextMilestone null', async () => {
    const result = await new CoinsService(overviewPrisma(1), config).getOverview('u1');
    expect(result.referralMilestones).toEqual([]);
    expect(result.nextMilestone).toBeNull();
  });
});
