import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StorefrontQuestService, QUESTS } from './storefront-quest.service';

function makeDeps(over: any = {}) {
  const prisma = {
    storefront: { findFirst: jest.fn() },
    storefrontItem: { count: jest.fn().mockResolvedValue(0) },
    commission: { count: jest.fn().mockResolvedValue(0) },
    coinTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    pointsTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ pointsBalance: 0 }) },
    ...over,
  } as any;
  const coins = { grant: jest.fn().mockResolvedValue(true) } as any;
  return { prisma, coins };
}

describe('StorefrontQuestService.listQuests', () => {
  it('ném NotFound nếu CTV chưa có gian hàng', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(null);
    const svc = new StorefrontQuestService(prisma, coins);
    await expect(svc.listQuests('u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tính done theo stats + claimed theo dòng QUEST ở sổ xu cũ HOẶC sổ điểm (PD-3)', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue({
      id: 'sf1', avatarUrl: 'a', headerNote: 'n', coverUrl: 'c', isPublished: true,
      collections: [{ items: [{ note: 'x' }, { note: null }, { note: 'y' }, { note: 'z' }, { note: 'w' }] }],
    });
    prisma.commission.count.mockResolvedValue(1);
    prisma.coinTransaction.findMany.mockResolvedValue([{ reason: 'STOREFRONT_QUEST:profile_complete' }]);
    prisma.pointsTransaction.findMany.mockResolvedValue([{ reason: 'STOREFRONT_QUEST:publish' }]);
    const svc = new StorefrontQuestService(prisma, coins);
    const out = await svc.listQuests('u1');
    const byCode = Object.fromEntries(out.quests.map((q) => [q.code, q]));
    expect(byCode['profile_complete']?.done).toBe(true);
    expect(byCode['profile_complete']?.claimed).toBe(true); // nhận bằng xu trước gộp
    expect(byCode['publish']?.claimed).toBe(true); // nhận bằng điểm sau gộp
    expect(byCode['add_5_products']?.done).toBe(true); // 5 items
    expect(byCode['add_5_products']?.claimed).toBe(false);
    for (const where of [prisma.coinTransaction.findMany.mock.calls[0][0].where, prisma.pointsTransaction.findMany.mock.calls[0][0].where]) {
      expect(where).toEqual({ userId: 'u1', refType: 'QUEST' });
    }
    expect(byCode['notes_3']?.done).toBe(true); // 4 có note >= 3
    expect(byCode['publish']?.done).toBe(true);
    expect(byCode['first_order']?.done).toBe(true);
    expect(out.totalEarnedPoints).toBe(2_000 + 1_000);
    expect(out).not.toHaveProperty('totalEarnedXu');
    expect(out.quests[0]).not.toHaveProperty('rewardXu');
    expect(out.level).toBe(2);
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
    expect(byCode['profile_complete']?.done).toBe(false);
    expect(byCode['add_5_products']?.progress).toBe(1);
    expect(byCode['add_5_products']?.done).toBe(false);
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
    expect(coins.grant).not.toHaveBeenCalled();
  });

  it('ném BadRequest nếu code không tồn tại', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(baseSf);
    const svc = new StorefrontQuestService(prisma, coins);
    await expect(svc.claimQuest('u1', 'khong-co')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cấp Điểm Xanh đúng reason + refType QUEST khi đạt, trả số dư điểm', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(baseSf);
    prisma.user.findUniqueOrThrow.mockResolvedValue({ pointsBalance: 7 });
    const svc = new StorefrontQuestService(prisma, coins);
    const out = await svc.claimQuest('u1', 'publish');
    expect(coins.grant).toHaveBeenCalledWith('u1', 1000, 'STOREFRONT_QUEST:publish', 'QUEST', 'sf1');
    expect(out).toEqual({ claimed: true, alreadyClaimed: false, code: 'publish', rewardPoints: 1000, pointsBalance: 7 });
  });

  it('đã nhận trước đó (bằng xu trước gộp hoặc bằng điểm) → báo đã nhận, không cấp thêm', async () => {
    const { prisma, coins } = makeDeps();
    prisma.storefront.findFirst.mockResolvedValue(baseSf);
    coins.grant.mockResolvedValue(false);
    const out = await new StorefrontQuestService(prisma, coins).claimQuest('u1', 'publish');
    expect(out).toMatchObject({ claimed: true, alreadyClaimed: true, rewardPoints: 1000 });
  });

  it('mức thưởng nhiệm vụ theo bảng PD-3 mục 4: 2.000/2.000/2.000/1.000/5.000 Điểm Xanh (1 xu = 1 điểm)', () => {
    expect(QUESTS.map((q) => [q.code, q.rewardPoints])).toEqual([
      ['profile_complete', 2_000],
      ['add_5_products', 2_000],
      ['notes_3', 2_000],
      ['publish', 1_000],
      ['first_order', 5_000],
    ]);
  });
});
