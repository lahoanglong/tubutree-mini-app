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
    mission: { findMany: jest.fn().mockResolvedValue([]) },
    missionProgress: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { ...base, ...over } as unknown as PrismaService;
}

const DAY = 24 * 3600 * 1000;
function profile(extra: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    totalSeeds: 100,
    streakDays: 0,
    longestStreak: 0,
    lastCheckInAt: null,
    treeStage: 1,
    ecoImpact: { progress: 0, target: 600, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 },
    ...extra,
  };
}

describe('GameService.checkIn', () => {
  it('lần đầu điểm danh → streak = 1, cộng seeds + điểm', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile());
    const svc = new GameService(prisma, makeConfig());
    const r = await svc.checkIn('u1');
    expect(r.streakDays).toBe(1);
    expect(r.seedsEarned).toBe(10); // default daily_login_seeds
    expect(r.pointsEarned).toBe(2);
    const upd = (prisma.gameProfile.update as jest.Mock).mock.calls[0][0].data;
    expect(upd.streakDays).toBe(1);
    expect(upd.longestStreak).toBe(1);
  });

  it('điểm danh liên tiếp (hôm qua) → streak tăng', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ streakDays: 4, longestStreak: 4, lastCheckInAt: new Date(Date.now() - DAY) }),
    );
    const r = await new GameService(prisma, makeConfig()).checkIn('u1');
    expect(r.streakDays).toBe(5);
  });

  it('bỏ lỡ ngày (3 hôm trước) → streak reset về 1', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ streakDays: 9, longestStreak: 9, lastCheckInAt: new Date(Date.now() - 3 * DAY) }),
    );
    const r = await new GameService(prisma, makeConfig()).checkIn('u1');
    expect(r.streakDays).toBe(1);
    // longestStreak giữ nguyên (max 9, 1)
    const upd = (prisma.gameProfile.update as jest.Mock).mock.calls[0][0].data;
    expect(upd.longestStreak).toBe(9);
  });

  it('đã điểm danh hôm nay → ném lỗi', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile({ lastCheckInAt: new Date() }));
    await expect(new GameService(prisma, makeConfig()).checkIn('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gameProfile.update).not.toHaveBeenCalled();
  });

  it('chuỗi 7 ngày → cộng bonus + note không có "undefined"', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ streakDays: 6, longestStreak: 6, lastCheckInAt: new Date(Date.now() - DAY) }),
    );
    const r = await new GameService(prisma, makeConfig()).checkIn('u1');
    expect(r.streakDays).toBe(7);
    expect(r.seedsEarned).toBe(30); // 10 + 20 bonus
    expect(r.bonusNote).toBe('+20 💧 chuỗi 7 ngày!');
    expect(r.bonusNote).not.toContain('undefined');
  });

  it('tổng seeds không vượt sức chứa bình (tank_capacity)', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile({ totalSeeds: 195 }));
    const r = await new GameService(prisma, makeConfig({ 'game.tank_capacity': 200 })).checkIn('u1');
    expect(r.totalSeeds).toBe(200); // 195 + 10 nhưng cap 200
  });
});

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

describe('GameService.answerQuiz', () => {
  it('câu không tồn tại → ném lỗi', async () => {
    const prisma = makePrisma();
    (prisma.gameQuiz.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(new GameService(prisma, makeConfig()).answerQuiz('u1', 'q1', 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('trả lời đúng → cộng điểm', async () => {
    const prisma = makePrisma();
    (prisma.gameQuiz.findUnique as jest.Mock).mockResolvedValue({ id: 'q1', correct: 2 });
    (prisma.gameQuizAttempt.findFirst as jest.Mock).mockResolvedValue(null);
    const r = await new GameService(prisma, makeConfig({ 'game.quiz_correct_points': 3 })).answerQuiz('u1', 'q1', 2);
    expect(r.isCorrect).toBe(true);
    expect(r.pointsEarned).toBe(3);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1); // creditPoints
  });

  it('trả lời sai → không cộng điểm nhưng trả về đáp án đúng', async () => {
    const prisma = makePrisma();
    (prisma.gameQuiz.findUnique as jest.Mock).mockResolvedValue({ id: 'q1', correct: 2 });
    (prisma.gameQuizAttempt.findFirst as jest.Mock).mockResolvedValue(null);
    const r = await new GameService(prisma, makeConfig()).answerQuiz('u1', 'q1', 0);
    expect(r.isCorrect).toBe(false);
    expect(r.pointsEarned).toBe(0);
    expect(r.correct).toBe(2);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('đã trả lời câu này hôm nay → ném lỗi', async () => {
    const prisma = makePrisma();
    (prisma.gameQuiz.findUnique as jest.Mock).mockResolvedValue({ id: 'q1', correct: 1 });
    (prisma.gameQuizAttempt.findFirst as jest.Mock).mockResolvedValue({ id: 'att1' });
    await expect(new GameService(prisma, makeConfig()).answerQuiz('u1', 'q1', 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.gameQuizAttempt.create).not.toHaveBeenCalled();
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
