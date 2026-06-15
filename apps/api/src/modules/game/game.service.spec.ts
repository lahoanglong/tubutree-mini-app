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
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { ...base, ...over } as unknown as PrismaService;
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
