import { CoinsService } from './coins.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RewardPointsService } from './reward-points.service';

const rewards = {} as RewardPointsService;

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
    await new CoinsService(prisma, rewards).spendCoins('u1', 5000, 'GAME_BUY_SEEDS', 'GAME');
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'u1', coinsBalance: { gte: 5000 } },
      data: { coinsBalance: { decrement: 5000 } },
    });
    expect(create.mock.calls[0][0].data).toMatchObject({ userId: 'u1', delta: -5000, reason: 'GAME_BUY_SEEDS', refType: 'GAME' });
  });

  it('không đủ xu (count 0) → throw', async () => {
    const { prisma } = spendPrisma(0);
    await expect(new CoinsService(prisma, rewards).spendCoins('u1', 5000, 'GAME_BUY_SEEDS', 'GAME')).rejects.toThrow('Không đủ TubuXu');
  });

  it('amount <= 0 → throw', async () => {
    const { prisma } = spendPrisma();
    await expect(new CoinsService(prisma, rewards).spendCoins('u1', 0, 'X', 'GAME')).rejects.toThrow();
  });

  it('truyền tx → dùng chính tx, KHÔNG mở $transaction mới', async () => {
    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      coinTransaction: { create: jest.fn().mockResolvedValue({}) },
    };
    const { prisma } = spendPrisma();
    await new CoinsService(prisma, rewards).spendCoins('u1', 100, 'ORDER_PAY:C1', 'ORDER', 'o1', tx as never);
    expect(tx.user.updateMany).toHaveBeenCalled();
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).not.toHaveBeenCalled();
  });
});

describe('CoinsService.getOverview (PD-3: phần giới thiệu lấy từ RewardPointsService, đơn vị Điểm Xanh)', () => {
  it('số dư/lịch sử xu cũ + thống kê giới thiệu bằng điểm', async () => {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ coinsBalance: 0 }) },
      coinTransaction: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]) },
    } as unknown as PrismaService;
    const referral = {
      referralCode: 'ABC123',
      successCount: 3,
      earnedPoints: 25,
      milestones: [{ count: 5, bonusPoints: 40 }],
      nextMilestone: { count: 5, bonusPoints: 40 },
    };
    const rewards = { getReferralOverview: jest.fn().mockResolvedValue(referral) } as unknown as RewardPointsService;
    expect(await new CoinsService(prisma, rewards).getOverview('u1')).toEqual({
      coinsBalance: 0,
      referralCode: 'ABC123',
      referralEarnedPoints: 25,
      referralSuccessCount: 3,
      referralMilestones: [{ count: 5, bonusPoints: 40 }],
      nextMilestone: { count: 5, bonusPoints: 40 },
      transactions: [{ id: 'c1' }],
    });
  });
});

describe('CoinsService không còn đường cộng xu (PD-3)', () => {
  it('không có grantCoins / grantReferralOrderReward', () => {
    const proto = CoinsService.prototype as unknown as Record<string, unknown>;
    expect(proto.grantCoins).toBeUndefined();
    expect(proto.grantReferralOrderReward).toBeUndefined();
  });
});
