import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StorefrontQuestService, QUESTS } from './storefront-quest.service';

function makeDeps(over: any = {}) {
  const prisma = {
    storefront: { findFirst: jest.fn() },
    storefrontItem: { count: jest.fn().mockResolvedValue(0) },
    commission: { count: jest.fn().mockResolvedValue(0) },
    coinTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ coinsBalance: 0 }) },
    ...over,
  } as any;
  const coins = { grantCoins: jest.fn().mockResolvedValue(undefined) } as any;
  return { prisma, coins };
}

describe('StorefrontQuestService.listQuests', () => {
  it('ném NotFound nếu CTV chưa có gian hàng', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(null);
    const svc = new StorefrontQuestService(prisma, coins);
    await expect(svc.listQuests('u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tính done theo stats + claimed theo CoinTransaction', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({
      id: 'sf1', avatarUrl: 'a', headerNote: 'n', coverUrl: 'c', isPublished: true,
      collections: [{ items: [{ note: 'x' }, { note: null }, { note: 'y' }, { note: 'z' }, { note: 'w' }] }],
    });
    prisma.commission.count.mockResolvedValue(1);
    prisma.coinTransaction.findMany.mockResolvedValue([{ reason: 'STOREFRONT_QUEST:profile_complete' }]);
    const svc = new StorefrontQuestService(prisma, coins);
    const out = await svc.listQuests('u1');
    const byCode = Object.fromEntries(out.quests.map((q) => [q.code, q]));
    expect(byCode['profile_complete'].done).toBe(true);
    expect(byCode['profile_complete'].claimed).toBe(true);
    expect(byCode['add_5_products'].done).toBe(true); // 5 items
    expect(byCode['add_5_products'].claimed).toBe(false);
    expect(byCode['notes_3'].done).toBe(true); // 4 có note >= 3
    expect(byCode['publish'].done).toBe(true);
    expect(byCode['first_order'].done).toBe(true);
    expect(out.totalEarnedXu).toBe(QUESTS.find((q) => q.code === 'profile_complete')!.rewardXu);
    expect(out.level).toBe(1);
    expect(out.levelMax).toBe(QUESTS.length);
  });

  it('done=false khi chưa đạt goal', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({
      id: 'sf1', avatarUrl: null, headerNote: null, coverUrl: null, isPublished: false,
      collections: [{ items: [{ note: null }] }],
    });
    const svc = new StorefrontQuestService(prisma, coins);
    const out = await svc.listQuests('u1');
    const byCode = Object.fromEntries(out.quests.map((q) => [q.code, q]));
    expect(byCode['profile_complete'].done).toBe(false);
    expect(byCode['add_5_products'].progress).toBe(1);
    expect(byCode['add_5_products'].done).toBe(false);
  });
});

describe('StorefrontQuestService.claimQuest', () => {
  const baseSf = {
    id: 'sf1', avatarUrl: 'a', headerNote: 'n', coverUrl: 'c', isPublished: true,
    collections: [{ items: [{ note: 'x' }, { note: 'y' }, { note: 'z' }, { note: 'w' }, { note: 'v' }] }],
  };

  it('ném BadRequest nếu quest chưa đạt', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({ ...baseSf, isPublished: false });
    const svc = new StorefrontQuestService(prisma, coins);
    await expect(svc.claimQuest('u1', 'publish')).rejects.toBeInstanceOf(BadRequestException);
    expect(coins.grantCoins).not.toHaveBeenCalled();
  });

  it('ném BadRequest nếu code không tồn tại', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(baseSf);
    const svc = new StorefrontQuestService(prisma, coins);
    await expect(svc.claimQuest('u1', 'khong-co')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('grantCoins đúng reason + refType QUEST khi đạt', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(baseSf);
    prisma.user.findUniqueOrThrow.mockResolvedValue({ coinsBalance: 4000 });
    const svc = new StorefrontQuestService(prisma, coins);
    const reward = QUESTS.find((q) => q.code === 'publish')!.rewardXu;
    const out = await svc.claimQuest('u1', 'publish');
    expect(coins.grantCoins).toHaveBeenCalledWith('u1', reward, 'STOREFRONT_QUEST:publish', 'QUEST', 'sf1');
    expect(out).toEqual({ claimed: true, code: 'publish', rewardXu: reward, coinsBalance: 4000 });
  });
});
