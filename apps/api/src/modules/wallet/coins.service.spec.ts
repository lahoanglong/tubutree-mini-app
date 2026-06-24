import { Prisma } from '@prisma/client';
import { CoinsService } from './coins.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T, // default: thưởng 5000 xu
} as unknown as SystemConfigService;

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
}

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
  it('hợp lệ → tạo CoinTransaction + cộng coinsBalance', async () => {
    const create = jest.fn().mockResolvedValue({});
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      coinTransaction: { create },
      user: { update },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    await new CoinsService(prisma, config).grantCoins('u1', 5000, 'CONVERT_FROM_WALLET', 'CONVERT');
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).toHaveBeenCalled();
  });

  it('P2002 (trùng reason REFERRAL) → nuốt, không throw', async () => {
    const prisma = {
      coinTransaction: { create: jest.fn() },
      user: { update: jest.fn() },
      $transaction: jest.fn().mockRejectedValue(p2002()),
    } as unknown as PrismaService;
    await expect(
      new CoinsService(prisma, config).grantCoins('u1', 5000, 'REFERRAL_CASHBACK:r1', 'REFERRAL', 'r1'),
    ).resolves.toBeUndefined();
  });

  it('amount <= 0 → no-op (không mở transaction)', async () => {
    const prisma = { $transaction: jest.fn() } as unknown as PrismaService;
    await new CoinsService(prisma, config).grantCoins('u1', 0, 'X');
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).not.toHaveBeenCalled();
  });
});

describe('CoinsService.grantReferralCoins', () => {
  function refPrisma(referredById: string | null) {
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ referredById }), update: jest.fn().mockResolvedValue({}) },
      coinTransaction: { create },
      $transaction: jest.fn().mockResolvedValue([]),
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
    const byReason = Object.fromEntries(create.mock.calls.map((c) => [c[0].data.reason, c[0].data]));
    expect(byReason['REFERRAL_CASHBACK:referee1']).toMatchObject({ userId: 'referrer1', delta: 5000, refType: 'REFERRAL' });
    expect(byReason['REFERRED_CASHBACK:referee1']).toMatchObject({ userId: 'referee1', delta: 5000, refType: 'REFERRAL' });
  });

  it('referredById trỏ chính mình → bỏ qua', async () => {
    const { prisma, create } = refPrisma('referee1');
    await new CoinsService(prisma, config).grantReferralCoins('referee1');
    expect(create).not.toHaveBeenCalled();
  });
});
