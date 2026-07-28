import { BadRequestException } from '@nestjs/common';
import { GameService } from './game.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/** Config mock: trả override theo key, nếu không có thì trả fallback. */
function makeConfig(overrides: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(k: string, fb?: T): Promise<T> => (k in overrides ? (overrides[k] as T) : (fb as T)),
  } as unknown as SystemConfigService;
}

/** Prisma stub linh hoạt — chỉ những bảng GameService dùng. */
function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    gameProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: { findUniqueOrThrow: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    pointsTransaction: { create: jest.fn() },
    gameSpin: { create: jest.fn().mockResolvedValue({}) },
    gameQuiz: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    gameQuizAttempt: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), create: jest.fn().mockResolvedValue({}) },
    coupon: { create: jest.fn().mockResolvedValue({}) },
    plantedTree: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    mission: { findMany: jest.fn().mockResolvedValue([]) },
    missionProgress: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (cbOrArr: unknown) => {
      if (typeof cbOrArr === 'function') return (cbOrArr as (tx: unknown) => unknown)(res);
      return [];
    }),
  };
  const res = { ...base, ...over } as unknown as PrismaService;
  return res;
}

function profile(extra: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    totalSeeds: 100,
    streakDays: 0,
    longestStreak: 0,
    lastCheckInAt: null,
    treeStage: 1,
    lastWateredAt: null,
    ecoImpact: { progress: 0, target: 600, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 },
    ...extra,
  };
}

describe('GameService.spin', () => {
  const PRIZES = [
    { id: 'a', name: 'A', weight: 70, rewardType: 'POINTS', value: 5 },
    { id: 'b', name: 'B', weight: 30, rewardType: 'NONE', value: 0 },
  ];

  it('không đủ điểm → ném lỗi, không trừ điểm', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', pointsBalance: 5 });
    const svc = new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 10 }));
    await expect(svc.spin('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gameSpin.create).not.toHaveBeenCalled();
  });

  it('chưa cấu hình giải → ném lỗi (sau khi đã hoàn điểm? không — kiểm tra trước trừ)', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', pointsBalance: 100 });
    const svc = new GameService(prisma, makeConfig({ 'game.spin_prizes': [] }));
    await expect(svc.spin('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled(); // chưa trừ điểm
  });

  it('quay trúng giải POINTS → trừ cost ATOMIC + cộng thưởng + ghi lịch sử', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', pointsBalance: 100 });
    jest.spyOn(Math, 'random').mockReturnValue(0.1); // r = 0.1*100 = 10 → giải 'a' (weight 70)
    const svc = new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES }));
    const r = await svc.spin('u1');
    expect(r.prize.id).toBe('a');
    // cost trừ atomic qua updateMany (where gte cost), thưởng POINTS qua creditPoints ($transaction)
    expect((prisma.user.updateMany as jest.Mock).mock.calls[0][0].where).toEqual({ id: 'u1', pointsBalance: { gte: 10 } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1); // chỉ thưởng dùng $transaction
    const spinData = (prisma.gameSpin.create as jest.Mock).mock.calls[0][0].data;
    expect(spinData.prizeId).toBe('a');
    (Math.random as jest.Mock).mockRestore();
  });

  it('race âm điểm: updateMany count=0 (điểm đã bị trừ) → ném lỗi, không quay', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', pointsBalance: 100 });
    (prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const svc = new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES }));
    await expect(svc.spin('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gameSpin.create).not.toHaveBeenCalled();
  });
});

describe('GameService.waterTree', () => {
  it('số giọt <= 0 → ném lỗi', async () => {
    const prisma = makePrisma();
    await expect(new GameService(prisma, makeConfig()).waterTree('u1', 0)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('không đủ giọt nước → ném lỗi', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile({ totalSeeds: 5 }));
    await expect(new GameService(prisma, makeConfig()).waterTree('u1', 20)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('tưới chưa đủ → tăng progress, chưa thu hoạch', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 100, target: 600, treeType: 't', treesPlanted: 0 } }),
    );
    const r = await new GameService(prisma, makeConfig()).waterTree('u1', 20);
    expect(r.harvested).toBe(false);
    expect(r.progress).toBe(120);
    expect(r.treesPlanted).toBe(0);
    expect(prisma.coupon.create).not.toHaveBeenCalled();
  });

  it('thu hoạch → CARRY-OVER phần dư, +1 cây, cấp coupon', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 590, target: 600, treeType: 't', treesPlanted: 2 } }),
    );
    const r = await new GameService(prisma, makeConfig()).waterTree('u1', 20); // 590+20=610 → harvest, dư 10
    expect(r.harvested).toBe(true);
    expect(r.progress).toBe(10); // carry-over, KHÔNG về 0
    expect(r.treesPlanted).toBe(3);
    expect(r.reward.coupon).toBeTruthy();
    expect(prisma.coupon.create).toHaveBeenCalledTimes(1);
    // Cam kết 1 cây thật + chứng nhận
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(1);
    expect(r.reward.certificate).toMatch(/^TUBU-/);
    expect((prisma.plantedTree.create as jest.Mock).mock.calls[0][0].data.certificateCode).toMatch(/^TUBU-/);
  });

  it('một lần tưới đủ nhiều cây (target nhỏ) → harvest nhiều lần, dư carry-over', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 30, treeType: 't', treesPlanted: 0 } }),
    );
    const r = await new GameService(prisma, makeConfig()).waterTree('u1', 70); // 70/30 = 2 cây, dư 10
    expect(r.harvested).toBe(true);
    expect(r.treesPlanted).toBe(2);
    expect(r.progress).toBe(10);
    expect(prisma.coupon.create).toHaveBeenCalledTimes(2);
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(2); // 2 cây thật cam kết
  });
});

describe('GameService.waterTree — auto-post Community Feed (§6.14.12)', () => {
  it('thu hoạch + feed injected → createAchievementPost (HARVEST)', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 590, target: 600, treeType: 't', treesPlanted: 0 } }),
    );
    const feed = { createAchievementPost: jest.fn().mockResolvedValue({}) };
    const svc = new GameService(prisma, makeConfig(), undefined, undefined, undefined, feed as never);
    await svc.waterTree('u1', 20);
    expect(feed.createAchievementPost).toHaveBeenCalledWith('u1', 'HARVEST', expect.any(String), expect.any(Object));
  });

  it('chưa thu hoạch → KHÔNG post', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 100, target: 600, treeType: 't', treesPlanted: 0 } }),
    );
    const feed = { createAchievementPost: jest.fn() };
    const svc = new GameService(prisma, makeConfig(), undefined, undefined, undefined, feed as never);
    await svc.waterTree('u1', 20);
    expect(feed.createAchievementPost).not.toHaveBeenCalled();
  });

  it('lỗi auto-post KHÔNG chặn thu hoạch', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 590, target: 600, treeType: 't', treesPlanted: 0 } }),
    );
    const feed = { createAchievementPost: jest.fn().mockRejectedValue(new Error('feed down')) };
    const svc = new GameService(prisma, makeConfig(), undefined, undefined, undefined, feed as never);
    const r = await svc.waterTree('u1', 20);
    expect(r.harvested).toBe(true);
  });
});

describe('GameService.getForest (Khu rừng của tôi §6.7.7)', () => {
  it('trả danh sách cây + đếm tổng/đã trồng', async () => {
    const prisma = makePrisma();
    (prisma.plantedTree.findMany as jest.Mock).mockResolvedValue([
      { certificateCode: 'TUBU-AAA', treeType: 't', status: 'PLANTED', region: 'Sơn La', pledgedAt: new Date(), plantedAt: new Date() },
      { certificateCode: 'TUBU-BBB', treeType: 't', status: 'PLEDGED', region: null, pledgedAt: new Date(), plantedAt: null },
    ]);
    const r = await new GameService(prisma, makeConfig()).getForest('u1');
    expect(r.count).toBe(2);
    expect(r.plantedCount).toBe(1);
    expect(r.trees[0]!.certificateCode).toBe('TUBU-AAA');
  });

  it('rừng trống → count 0', async () => {
    const prisma = makePrisma();
    const r = await new GameService(prisma, makeConfig()).getForest('u1');
    expect(r.count).toBe(0);
    expect(r.plantedCount).toBe(0);
  });
});

describe('GameService.treeHealth (§6.7.3 héo/chết)', () => {
  const DAYMS = 24 * 3600 * 1000;
  async function health(extra: Record<string, unknown>) {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile(extra));
    const r = (await new GameService(prisma, makeConfig()).getProfile('u1')) as { treeHealth: string };
    return r.treeHealth;
  }

  it('chưa có tiến trình → HEALTHY dù lâu không tưới', async () => {
    expect(await health({ lastWateredAt: new Date(Date.now() - 10 * DAYMS), ecoImpact: { progress: 0, target: 600 } })).toBe('HEALTHY');
  });
  it('tưới gần đây → HEALTHY', async () => {
    expect(await health({ lastWateredAt: new Date(Date.now() - 1 * DAYMS), ecoImpact: { progress: 100, target: 600 } })).toBe('HEALTHY');
  });
  it('4 ngày không tưới (có tiến trình) → WILTED', async () => {
    expect(await health({ lastWateredAt: new Date(Date.now() - 4 * DAYMS), ecoImpact: { progress: 100, target: 600 } })).toBe('WILTED');
  });
  it('8 ngày không tưới → DEAD', async () => {
    expect(await health({ lastWateredAt: new Date(Date.now() - 8 * DAYMS), ecoImpact: { progress: 100, target: 600 } })).toBe('DEAD');
  });
});

describe('GameService.getProfile — streak repair (hồi sinh chuỗi đã mất)', () => {
  const DAYMS = 24 * 3600 * 1000;
  it('có brokenStreakAt trong 48h, chưa hồi sinh gần đây → streakRepairable=true', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ brokenStreakDays: 5, brokenStreakAt: new Date(Date.now() - DAYMS), lastStreakRepairAt: null }),
    );
    const r = (await new GameService(prisma, makeConfig({ 'game.streak_repair_cost': 150 })).getProfile('u1')) as {
      brokenStreakDays: number; streakRepairCost: number; streakRepairable: boolean;
    };
    expect(r.brokenStreakDays).toBe(5);
    expect(r.streakRepairCost).toBe(150);
    expect(r.streakRepairable).toBe(true);
  });

  it('không có brokenStreakAt → streakRepairable=false', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ brokenStreakDays: 0, brokenStreakAt: null }),
    );
    const r = (await new GameService(prisma, makeConfig()).getProfile('u1')) as { streakRepairable: boolean };
    expect(r.streakRepairable).toBe(false);
  });

  it('brokenStreakAt quá 48h → streakRepairable=false', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ brokenStreakDays: 5, brokenStreakAt: new Date(Date.now() - 49 * 3600 * 1000) }),
    );
    const r = (await new GameService(prisma, makeConfig({ 'game.streak_repair_window_hours': 48 })).getProfile('u1')) as { streakRepairable: boolean };
    expect(r.streakRepairable).toBe(false);
  });

  it('còn trong cooldown kể từ lần hồi sinh trước → streakRepairable=false', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({
        brokenStreakDays: 5, brokenStreakAt: new Date(Date.now() - DAYMS),
        lastStreakRepairAt: new Date(Date.now() - 10 * DAYMS),
      }),
    );
    const r = (await new GameService(prisma, makeConfig({ 'game.streak_repair_cooldown_days': 30 })).getProfile('u1')) as { streakRepairable: boolean };
    expect(r.streakRepairable).toBe(false);
  });
});

describe('GameService.waterTree — cây chết mất tiến trình (§6.7.3)', () => {
  it('tưới cây CHẾT (8 ngày) → reset tiến trình rồi +drops, revivedFromDead', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, lastWateredAt: new Date(Date.now() - 8 * 86400000), ecoImpact: { progress: 500, target: 600, treeType: 't', treesPlanted: 1 } }),
    );
    const r = (await new GameService(prisma, makeConfig()).waterTree('u1', 20)) as { progress: number; revivedFromDead: boolean; harvested: boolean };
    expect(r.revivedFromDead).toBe(true);
    expect(r.progress).toBe(20); // 500 bị reset về 0 rồi +20
    expect(r.harvested).toBe(false);
  });

  it('tưới cây còn sống → giữ tiến trình', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, lastWateredAt: new Date(Date.now() - 1 * 86400000), ecoImpact: { progress: 500, target: 600, treeType: 't', treesPlanted: 0 } }),
    );
    const r = (await new GameService(prisma, makeConfig()).waterTree('u1', 20)) as { progress: number; revivedFromDead: boolean };
    expect(r.revivedFromDead).toBe(false);
    expect(r.progress).toBe(520);
  });
});

describe('GameService.buySeeds / buyTree (mua bằng TubuXu)', () => {
  // $transaction chạy callback để spendCoins + cập nhật chạy thật.
  function buyPrisma(over: Record<string, unknown> = {}) {
    const prisma = makePrisma(over) as unknown as Record<string, unknown>;
    (prisma as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma));
    return prisma as unknown as PrismaService;
  }
  const coinsStub = () => ({ spendCoins: jest.fn().mockResolvedValue(undefined) });

  it('mua nước: trừ xu (seeds×1) + cộng totalSeeds ATOMIC (increment, guard cap), không vượt sức chứa', async () => {
    const prisma = buyPrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile({ totalSeeds: 100 }));
    const coins = coinsStub();
    const svc = new GameService(prisma, makeConfig(), undefined, undefined, coins as never);
    const r = await svc.buySeeds('u1', 50);
    expect(r).toMatchObject({ seeds: 50, cost: 50, totalSeeds: 150 });
    expect(coins.spendCoins).toHaveBeenCalledWith('u1', 50, 'GAME_BUY_SEEDS', 'GAME', undefined, prisma);
    // Cộng ATOMIC qua updateMany increment + guard cap (chống lost-update khi mua song song),
    // KHÔNG set giá trị tuyệt đối đọc-ngoài-tx.
    const call = (prisma.gameProfile.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'u1', totalSeeds: { lte: 500 - 50 } });
    expect(call.data).toEqual({ totalSeeds: { increment: 50 } });
  });

  it('mua nước vượt sức chứa bình (check sớm) → throw, KHÔNG trừ xu', async () => {
    const prisma = buyPrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile({ totalSeeds: 480 }));
    const coins = coinsStub();
    const svc = new GameService(prisma, makeConfig({ 'game.tank_capacity': 500 }), undefined, undefined, coins as never);
    await expect(svc.buySeeds('u1', 50)).rejects.toThrow('Bình chứa');
    expect(coins.spendCoins).not.toHaveBeenCalled();
  });

  it('lost-update race: updateMany guard cap count=0 (bình đầy do lệnh song song) → throw rollback', async () => {
    const prisma = buyPrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile({ totalSeeds: 100 }));
    (prisma.gameProfile.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const coins = coinsStub();
    const svc = new GameService(prisma, makeConfig({ 'game.tank_capacity': 500 }), undefined, undefined, coins as never);
    // Vượt cap atomic → throw → tx rollback (xu vừa trừ được hoàn lại do rollback).
    await expect(svc.buySeeds('u1', 50)).rejects.toThrow('Bình chứa');
  });

  it('mua cây thật: trừ xu (tree_xu_price) + tạo PlantedTree có chứng nhận', async () => {
    const prisma = buyPrisma();
    const coins = coinsStub();
    const svc = new GameService(prisma, makeConfig({ 'game.tree_xu_price': 50000 }), undefined, undefined, coins as never);
    const r = await svc.buyTree('u1');
    expect(r.cost).toBe(50000);
    expect(r.certificateCode).toMatch(/^TUBU-/);
    expect(coins.spendCoins).toHaveBeenCalledWith('u1', 50000, expect.stringMatching(/^GAME_BUY_TREE:TUBU-/), 'GAME', undefined, prisma);
    expect((prisma.plantedTree.create as jest.Mock).mock.calls[0][0].data.certificateCode).toBe(r.certificateCode);
  });
});

describe('GameService.getMissions', () => {
  it('tính toán tiến trình real-time cho từng nhiệm vụ', async () => {
    const prisma = makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 3 }) },
      order: { count: jest.fn().mockResolvedValue(1) },
      review: { count: jest.fn().mockResolvedValue(2) },
      user: { count: jest.fn().mockResolvedValue(0) },
      mission: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'm1', code: 'CHECKIN_7', title: 'Chăm chỉ 7 ngày', goal: 7, rewardPoints: 30 },
          { id: 'm2', code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', goal: 1, rewardPoints: 20 },
          { id: 'm3', code: 'REVIEW_3', title: 'Nhà phê bình', goal: 3, rewardPoints: 15 },
          { id: 'm4', code: 'INVITE_3', title: 'Lan tỏa sống xanh', goal: 3, rewardPoints: 50 },
        ]),
      },
    });
    const svc = new GameService(prisma, makeConfig());
    const res = await svc.getMissions('u1');
    expect(res).toEqual([
      { code: 'CHECKIN_7', title: 'Chăm chỉ 7 ngày', description: undefined, rewardPoints: 30, progress: 3, goal: 7, completed: false },
      { code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', description: undefined, rewardPoints: 20, progress: 1, goal: 1, completed: true },
      { code: 'REVIEW_3', title: 'Nhà phê bình', description: undefined, rewardPoints: 15, progress: 2, goal: 3, completed: false },
      { code: 'INVITE_3', title: 'Lan tỏa sống xanh', description: undefined, rewardPoints: 50, progress: 0, goal: 3, completed: false },
    ]);
  });
});

describe('GameService.pickWeighted (phân phối theo trọng số)', () => {
  type Prize = { id: string; name: string; weight: number; rewardType: string; value: number };
  const pick = (prizes: Prize[], rand: number) => {
    jest.spyOn(Math, 'random').mockReturnValue(rand);
    const svc = new GameService(makePrisma(), makeConfig()) as unknown as { pickWeighted(p: Prize[]): Prize };
    const out = svc.pickWeighted(prizes);
    (Math.random as jest.Mock).mockRestore();
    return out;
  };
  const PRIZES: Prize[] = [
    { id: 'a', name: 'A', weight: 70, rewardType: 'NONE', value: 0 },
    { id: 'b', name: 'B', weight: 30, rewardType: 'NONE', value: 0 },
  ];

  it('rand thấp → giải đầu (trọng số lớn)', () => {
    expect(pick(PRIZES, 0.0).id).toBe('a'); // r=0 → trừ 70 ≤0 → a
  });
  it('rand cao → giải sau', () => {
    expect(pick(PRIZES, 0.99).id).toBe('b'); // r=99 → 99-70=29>0 → 29-30≤0 → b
  });
});
