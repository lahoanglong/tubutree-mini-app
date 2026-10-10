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

describe('CoinsService.grantReferralCoins', () => {
  function refPrisma(referredById: string | null) {
    const create = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ referredById }), update: jest.fn().mockResolvedValue({}) },
      coinTransaction: { createMany: create },
      $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma)),
    } as unknown as PrismaService;
    return { prisma, create };
  }

  it('referee không có người giới thiệu → không thưởng', async () => {
    const { prisma, create } = refPrisma(null);
    await new CoinsService(prisma, config).grantReferralCoins('referee1');
    expect(create).not.toHaveBeenCalled();
  });

  it('có người giới thiệu → thưởng CẢ HAI, reason đúng', async () => {
    const { prisma, create } = refPrisma('referrer1');
    await new CoinsService(prisma, config).grantReferralCoins('referee1');
    const byReason = Object.fromEntries(create.mock.calls.map((c) => [c[0].data[0].reason, c[0].data[0]]));
    expect(byReason['REFERRAL_CASHBACK:referee1']).toMatchObject({ userId: 'referrer1', delta: 5000, refType: 'REFERRAL' });
    expect(byReason['REFERRED_CASHBACK:referee1']).toMatchObject({ userId: 'referee1', delta: 5000, refType: 'REFERRAL' });
  });

  it('referredById trỏ chính mình → bỏ qua', async () => {
    const { prisma, create } = refPrisma('referee1');
    await new CoinsService(prisma, config).grantReferralCoins('referee1');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('CoinsService.grantReferralCoins → thưởng mốc giới thiệu', () => {
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

  function refPrismaWithCount(successCount: number) {
    const create = jest.fn().mockResolvedValue({ count: 1 });
    const count = jest.fn().mockResolvedValue(successCount);
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ referredById: 'referrer1' }), update: jest.fn().mockResolvedValue({}) },
      coinTransaction: { createMany: create, count },
      $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma)),
    } as unknown as PrismaService;
    return { prisma, create, count };
  }

  it('vừa chạm mốc 3 → thưởng thêm, reason nhúng referrerId + số mốc', async () => {
    const { prisma, create } = refPrismaWithCount(3);
    await new CoinsService(prisma, milestoneConfig(milestones)).grantReferralCoins('referee1');
    const byReason = Object.fromEntries(create.mock.calls.map((c) => [c[0].data[0].reason, c[0].data[0]]));
    expect(byReason['REFERRAL_MILESTONE:referrer1:3']).toMatchObject({ userId: 'referrer1', delta: 20000, refType: 'REFERRAL' });
  });

  it('chưa chạm mốc nào (count 2) → không thưởng thêm', async () => {
    const { prisma, create } = refPrismaWithCount(2);
    await new CoinsService(prisma, milestoneConfig(milestones)).grantReferralCoins('referee1');
    const reasons = create.mock.calls.map((c) => c[0].data[0].reason);
    expect(reasons.some((r) => r.startsWith('REFERRAL_MILESTONE:'))).toBe(false);
  });

  it('vượt mọi mốc (count 15) → thử thưởng cả 3 mốc (idempotency ở grantCoins chặn lặp thực tế)', async () => {
    const { prisma, create } = refPrismaWithCount(15);
    await new CoinsService(prisma, milestoneConfig(milestones)).grantReferralCoins('referee1');
    const reasons = create.mock.calls.map((c) => c[0].data[0].reason);
    expect(reasons).toEqual(
      expect.arrayContaining(['REFERRAL_MILESTONE:referrer1:3', 'REFERRAL_MILESTONE:referrer1:5', 'REFERRAL_MILESTONE:referrer1:10']),
    );
  });

  it('không cấu hình mốc nào (config mặc định trả []) → không đếm, không thưởng thêm', async () => {
    const { prisma, create, count } = refPrismaWithCount(3);
    await new CoinsService(prisma, config).grantReferralCoins('referee1');
    expect(count).not.toHaveBeenCalled();
    const reasons = create.mock.calls.map((c) => c[0].data[0].reason);
    expect(reasons.some((r) => r.startsWith('REFERRAL_MILESTONE:'))).toBe(false);
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
        count: jest.fn().mockResolvedValue(successCount),
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
