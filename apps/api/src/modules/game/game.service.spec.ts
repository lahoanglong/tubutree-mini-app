import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
import { GameService } from './game.service';
import { treeCertificateCodeFor } from './tree-purchase-key';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';

/**
 * Mock analytics dùng chung cho các test không assert riêng — wiring THẬT (không @Optional()
 * no-op câm lặng) ở mọi construction để lộ lỗi ngay nếu sau này thêm event mà quên/gọi sai chữ
 * ký (Task 9). Các test riêng cho spin()/waterTree() dựng mock analytics + tx RIÊNG bên dưới để
 * assert đúng eventName/props VÀ tx-identity (khác instance prisma top-level).
 */
const analytics = {
  record: jest.fn().mockResolvedValue(undefined),
  recordBestEffort: jest.fn().mockResolvedValue(undefined),
} as unknown as AnalyticsEventsService;

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
    user: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    pointsTransaction: { create: jest.fn() },
    gameSpin: { create: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
    gameQuiz: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    gameQuizAttempt: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), create: jest.fn().mockResolvedValue({}) },
    coupon: { create: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
    plantedTree: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    mission: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    missionProgress: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
    order: { count: jest.fn().mockResolvedValue(0) },
    review: { count: jest.fn().mockResolvedValue(0) },
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
    const svc = new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 10 }), analytics);
    await expect(svc.spin('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gameSpin.create).not.toHaveBeenCalled();
  });

  it('chưa cấu hình giải → ném lỗi (sau khi đã hoàn điểm? không — kiểm tra trước trừ)', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', pointsBalance: 100 });
    const svc = new GameService(prisma, makeConfig({ 'game.spin_prizes': [] }), analytics);
    await expect(svc.spin('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled(); // chưa trừ điểm
  });

  it('quay trúng giải POINTS → trừ cost ATOMIC + cộng thưởng + ghi lịch sử', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', pointsBalance: 100 });
    jest.spyOn(Math, 'random').mockReturnValue(0.1); // r = 0.1*100 = 10 → giải 'a' (weight 70)
    const svc = new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES }), analytics);
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
    const svc = new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES }), analytics);
    await expect(svc.spin('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gameSpin.create).not.toHaveBeenCalled();
  });

  // C-043: game.spin_buy_daily_limit từng là khoá chết — vòng quay không có trần lượt/ngày.
  it('đã quay đủ trần lượt/ngày → BadRequest, không ghi lượt quay, không trao thưởng', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', pointsBalance: 100 });
    (prisma.gameSpin.count as jest.Mock).mockResolvedValue(5);
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const svc = new GameService(
      prisma,
      makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES, 'game.spin_buy_daily_limit': 5 }),
      analytics,
    );
    await expect(svc.spin('u1')).rejects.toThrow('lượt');
    expect(prisma.gameSpin.create).not.toHaveBeenCalled();
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    (Math.random as jest.Mock).mockRestore();
  });

  it('trần lượt/ngày mặc định 5 khi thiếu config; còn dưới trần → quay bình thường', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', pointsBalance: 100 });
    (prisma.gameSpin.count as jest.Mock).mockResolvedValueOnce(4).mockResolvedValueOnce(5);
    const svc = new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES }), analytics);
    await expect(svc.spin('u1')).resolves.toBeDefined();
    await expect(svc.spin('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gameSpin.create).toHaveBeenCalledTimes(1);
  });

  it('đếm lượt TRONG tx, SAU khi trừ điểm (khoá dòng user) và theo ngày giờ VN', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', pointsBalance: 100 });
    const svc = new GameService(
      prisma,
      makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES, 'game.spin_buy_daily_limit': 5 }),
      analytics,
    );
    await svc.spin('u1');
    const dec = (prisma.user.updateMany as jest.Mock).mock.invocationCallOrder[0]!;
    const cnt = (prisma.gameSpin.count as jest.Mock).mock.invocationCallOrder[0]!;
    expect(cnt).toBeGreaterThan(dec);
    const where = (prisma.gameSpin.count as jest.Mock).mock.calls[0][0].where;
    expect(where.userId).toBe('u1');
    const since: Date = where.spunAt.gte;
    // 00:00 giờ VN = 17:00 UTC hôm trước.
    expect(since.getUTCHours()).toBe(17);
    expect(Date.now() - since.getTime()).toBeLessThan(864e5);
  });

  /**
   * Task 9: quay xong → engagement_action ghi qua record(tx,...) — PHẢI dùng đúng `tx` của
   * transaction đang chạy (atomic cùng transaction), KHÔNG phải recordBestEffort. Dựng tx RIÊNG
   * (khác instance với `prisma` top-level) để chứng minh code truyền đúng tx thật vào record(),
   * không phải lén truyền this.prisma (lesson (b) — điểm yếu nhất được review flag ở task trước).
   */
  it('quay xong → ghi engagement_action qua record(tx,...) với ĐÚNG tx (khác instance prisma top-level)', async () => {
    const prisma = makePrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'u1', pointsBalance: 100 });
    jest.spyOn(Math, 'random').mockReturnValue(0.1); // → giải 'a' (POINTS, weight 70)
    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
      pointsTransaction: { create: jest.fn().mockResolvedValue({}) },
      gameProfile: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      gameSpin: { create: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
      coupon: { create: jest.fn().mockResolvedValue({}) },
    };
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: unknown) => unknown) => cb(tx));
    const spy = { record: jest.fn().mockResolvedValue(undefined), recordBestEffort: jest.fn().mockResolvedValue(undefined) };
    const svc = new GameService(
      prisma,
      makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES }),
      spy as unknown as AnalyticsEventsService,
    );
    await svc.spin('u1');
    expect(tx).not.toBe(prisma); // tx RIÊNG, không phải cùng instance với prisma top-level
    expect(spy.record).toHaveBeenCalledTimes(1);
    expect(spy.record).toHaveBeenCalledWith(tx, {
      eventName: 'engagement_action',
      userId: 'u1',
      platform: 'miniapp',
      props: { action: 'spin', prizeId: 'a', rewardType: 'POINTS', rewardRefId: null },
    });
    expect(spy.recordBestEffort).not.toHaveBeenCalled();
    (Math.random as jest.Mock).mockRestore();
  });
});

describe('GameService.waterTree', () => {
  it('số giọt <= 0 → ném lỗi', async () => {
    const prisma = makePrisma();
    await expect(new GameService(prisma, makeConfig(), analytics).waterTree('u1', 0)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('không đủ giọt nước → ném lỗi', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile({ totalSeeds: 5 }));
    await expect(new GameService(prisma, makeConfig(), analytics).waterTree('u1', 20)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('tưới chưa đủ → tăng progress, chưa thu hoạch', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 100, target: 600, treeType: 't', treesPlanted: 0 } }),
    );
    const r = await new GameService(prisma, makeConfig(), analytics).waterTree('u1', 20);
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
    const r = await new GameService(prisma, makeConfig(), analytics).waterTree('u1', 20); // 590+20=610 → harvest, dư 10
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
    const r = await new GameService(prisma, makeConfig(), analytics).waterTree('u1', 70); // 70/30 = 2 cây, dư 10
    expect(r.harvested).toBe(true);
    expect(r.treesPlanted).toBe(2);
    expect(r.progress).toBe(10);
    expect(prisma.coupon.create).toHaveBeenCalledTimes(2);
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(2); // 2 cây thật cam kết
  });

  // C-009 (Q-02): coupon thu hoạch chỉ dùng được cho đơn từ 199.000đ (đọc config), không còn
  // minOrder = giá trị coupon (30k) — chặn biến nước miễn phí thành tiền free trên đơn nhỏ.
  it('coupon thu hoạch: minOrder mặc định 199.000đ (game.harvest_coupon_min_order)', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 590, target: 600, treeType: 't', treesPlanted: 0 } }),
    );
    await new GameService(prisma, makeConfig(), analytics).waterTree('u1', 20);
    const data = (prisma.coupon.create as jest.Mock).mock.calls[0][0].data;
    expect(data.value).toBe(30000);
    expect(data.minOrder).toBe(199000);
  });

  it('coupon thu hoạch: minOrder theo config, nhưng KHÔNG bao giờ thấp hơn giá trị coupon', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 30, treeType: 't', treesPlanted: 0 } }),
    );
    await new GameService(
      prisma,
      makeConfig({ 'game.harvest_coupon_min_order': 250000, 'game.harvest_coupon_amount': 30000 }),
      analytics,
    ).waterTree('u1', 30);
    expect((prisma.coupon.create as jest.Mock).mock.calls[0][0].data.minOrder).toBe(250000);

    const prisma2 = makePrisma();
    (prisma2.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 30, treeType: 't', treesPlanted: 0 } }),
    );
    await new GameService(
      prisma2,
      makeConfig({ 'game.harvest_coupon_min_order': 0, 'game.harvest_coupon_amount': 30000 }),
      analytics,
    ).waterTree('u1', 30);
    expect((prisma2.coupon.create as jest.Mock).mock.calls[0][0].data.minOrder).toBe(30000);
  });

  // P0-1 (docs/2026-09-08-review-progress.md): xu mua nước rẻ hơn NHIỀU giá trị coupon thu
  // hoạch (harvest_coupon_amount mặc định 30.000đ, nước chỉ 1 xu/giọt ≈ 0,83đ) → không giới
  // hạn số coupon/ngày thì cứ vòng mua-tưới là in tiền vô hạn. Cap cứng bằng CODE, không phụ
  // thuộc giá trị config (admin đổi config không được vô tình tắt lưới an toàn này).
  it('đã đạt trần coupon thu hoạch/ngày → vẫn thu hoạch (cây + chứng nhận) nhưng KHÔNG cấp thêm coupon', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 30, treeType: 't', treesPlanted: 0 } }),
    );
    (prisma.coupon.count as jest.Mock).mockResolvedValue(3); // đã đủ trần mặc định (3/ngày)
    const r = await new GameService(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3 }), analytics).waterTree('u1', 70); // vẫn đủ 2 lần harvest
    expect(r.harvested).toBe(true);
    expect(r.treesPlanted).toBe(2);
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(2);
    expect(prisma.coupon.create).not.toHaveBeenCalled();
    expect(r.reward.coupon).toBeUndefined();
  });

  it('còn dưới trần → cấp coupon tới khi CHẠM trần trong CÙNG 1 lần tưới, phần sau đó thì thôi', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 30, treeType: 't', treesPlanted: 0 } }),
    );
    (prisma.coupon.count as jest.Mock).mockResolvedValue(2); // còn đúng 1 suất trước khi chạm trần 3
    const r = await new GameService(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3 }), analytics).waterTree('u1', 70); // 2 lần harvest trong lần gọi này
    expect(r.treesPlanted).toBe(2);
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(2); // cây vẫn trồng đủ cả 2
    expect(prisma.coupon.create).toHaveBeenCalledTimes(1); // chỉ 1 coupon (suất còn lại) — lần 2 chạm trần
  });

  // P2-4 (docs/2026-09-08-review-progress.md): eco.target=0 (config game.tree_default_target
  // bị set sai) → while(progress>=target) không bao giờ thoát — vòng lặp vô hạn TRONG
  // transaction Serializable, giữ lock/connection tới khi pool timeout. game-garden.service.ts
  // đã có guard này (sibling), waterTree() thì chưa — mirror lại.
  it('eco.target <= 0 (config sai) → BadRequest ngay, KHÔNG rơi vào vòng lặp vô hạn', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 0, treeType: 't', treesPlanted: 0 } }),
    );
    await expect(new GameService(prisma, makeConfig(), analytics).waterTree('u1', 20)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('race Serializable (P2034 — 2 request song song đụng trần) → BadRequest rõ ràng, không nuốt lỗi', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 590, target: 600, treeType: 't', treesPlanted: 0 } }),
    );
    (prisma.$transaction as jest.Mock).mockRejectedValue(
      Object.assign(new Error('could not serialize access'), { code: 'P2034' }),
    );
    await expect(new GameService(prisma, makeConfig(), analytics).waterTree('u1', 20)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  /**
   * Task 9: tưới xong (thành công) → engagement_action ghi qua record(tx,...) trong CÙNG
   * transaction Serializable, dùng ĐÚNG `tx` (không phải recordBestEffort, không phải lén
   * truyền this.prisma — lesson (b), dựng tx RIÊNG khác instance với prisma top-level).
   */
  it('tưới xong → ghi engagement_action qua record(tx,...) với ĐÚNG tx (khác instance prisma top-level)', async () => {
    const prisma = makePrisma();
    const tx = {
      gameProfile: {
        findUnique: jest.fn().mockResolvedValue(
          profile({ totalSeeds: 100, ecoImpact: { progress: 100, target: 600, treeType: 't', treesPlanted: 0 } }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      coupon: { count: jest.fn().mockResolvedValue(0) },
    };
    (prisma.$transaction as jest.Mock).mockImplementation((cb: (t: unknown) => unknown) => cb(tx));
    const spy = { record: jest.fn().mockResolvedValue(undefined), recordBestEffort: jest.fn().mockResolvedValue(undefined) };
    const svc = new GameService(prisma, makeConfig(), spy as unknown as AnalyticsEventsService);
    await svc.waterTree('u1', 20);
    expect(tx).not.toBe(prisma); // tx RIÊNG, không phải cùng instance với prisma top-level
    expect(spy.record).toHaveBeenCalledTimes(1);
    expect(spy.record).toHaveBeenCalledWith(tx, {
      eventName: 'engagement_action',
      userId: 'u1',
      platform: 'miniapp',
      props: { action: 'water_tree', drops: 20 },
    });
    expect(spy.recordBestEffort).not.toHaveBeenCalled();
  });
});

describe('GameService.waterTree — auto-post Community Feed (§6.14.12)', () => {
  it('thu hoạch + feed injected → createAchievementPost (HARVEST)', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 590, target: 600, treeType: 't', treesPlanted: 0 } }),
    );
    const feed = { createAchievementPost: jest.fn().mockResolvedValue({}) };
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, feed as never);
    await svc.waterTree('u1', 20);
    expect(feed.createAchievementPost).toHaveBeenCalledWith('u1', 'HARVEST', expect.any(String), expect.any(Object));
  });

  it('chưa thu hoạch → KHÔNG post', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 100, target: 600, treeType: 't', treesPlanted: 0 } }),
    );
    const feed = { createAchievementPost: jest.fn() };
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, feed as never);
    await svc.waterTree('u1', 20);
    expect(feed.createAchievementPost).not.toHaveBeenCalled();
  });

  it('lỗi auto-post KHÔNG chặn thu hoạch', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 590, target: 600, treeType: 't', treesPlanted: 0 } }),
    );
    const feed = { createAchievementPost: jest.fn().mockRejectedValue(new Error('feed down')) };
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, feed as never);
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
    const r = await new GameService(prisma, makeConfig(), analytics).getForest('u1');
    expect(r.count).toBe(2);
    expect(r.plantedCount).toBe(1);
    expect(r.trees[0]!.certificateCode).toBe('TUBU-AAA');
  });

  it('rừng trống → count 0', async () => {
    const prisma = makePrisma();
    const r = await new GameService(prisma, makeConfig(), analytics).getForest('u1');
    expect(r.count).toBe(0);
    expect(r.plantedCount).toBe(0);
  });
});

describe('GameService.treeHealth (§6.7.3 héo/chết)', () => {
  const DAYMS = 24 * 3600 * 1000;
  async function health(extra: Record<string, unknown>) {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile(extra));
    const r = (await new GameService(prisma, makeConfig(), analytics).getProfile('u1')) as { treeHealth: string };
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
    const r = (await new GameService(prisma, makeConfig({ 'game.streak_repair_cost': 150 }), analytics).getProfile('u1')) as {
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
    const r = (await new GameService(prisma, makeConfig(), analytics).getProfile('u1')) as { streakRepairable: boolean };
    expect(r.streakRepairable).toBe(false);
  });

  it('brokenStreakAt quá 48h → streakRepairable=false', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ brokenStreakDays: 5, brokenStreakAt: new Date(Date.now() - 49 * 3600 * 1000) }),
    );
    const r = (await new GameService(prisma, makeConfig({ 'game.streak_repair_window_hours': 48 }), analytics).getProfile('u1')) as { streakRepairable: boolean };
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
    const r = (await new GameService(prisma, makeConfig({ 'game.streak_repair_cooldown_days': 30 }), analytics).getProfile('u1')) as { streakRepairable: boolean };
    expect(r.streakRepairable).toBe(false);
  });
});

describe('GameService.waterTree — cây chết mất tiến trình (§6.7.3)', () => {
  it('tưới cây CHẾT (8 ngày) → reset tiến trình rồi +drops, revivedFromDead', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, lastWateredAt: new Date(Date.now() - 8 * 86400000), ecoImpact: { progress: 500, target: 600, treeType: 't', treesPlanted: 1 } }),
    );
    const r = (await new GameService(prisma, makeConfig(), analytics).waterTree('u1', 20)) as { progress: number; revivedFromDead: boolean; harvested: boolean };
    expect(r.revivedFromDead).toBe(true);
    expect(r.progress).toBe(20); // 500 bị reset về 0 rồi +20
    expect(r.harvested).toBe(false);
  });

  it('tưới cây còn sống → giữ tiến trình', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, lastWateredAt: new Date(Date.now() - 1 * 86400000), ecoImpact: { progress: 500, target: 600, treeType: 't', treesPlanted: 0 } }),
    );
    const r = (await new GameService(prisma, makeConfig(), analytics).waterTree('u1', 20)) as { progress: number; revivedFromDead: boolean };
    expect(r.revivedFromDead).toBe(false);
    expect(r.progress).toBe(520);
  });
});

describe('GameService.buySeeds / buyTree (mua nước đã ngừng, góp quỹ trồng cây bằng Điểm Xanh)', () => {
  /**
   * Sổ điểm giả theo lô: updateMany có guard gte trên đúng cột, create ghi dòng sổ — đủ để kiểm
   * applyPointsDelta (points-ledger.ts) trừ đúng lô mà không cần Postgres (race thật ở T6/pd3 race spec).
   */
  function buyPrisma(balances: { pointsBalance: number; pointsConvertedBalance: number }) {
    const state = { ...balances };
    const entries: Record<string, unknown>[] = [];
    const trees: Record<string, unknown>[] = [];
    const prisma = makePrisma({
      user: {
        findUniqueOrThrow: jest.fn(async () => ({ id: 'u1', ...state })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const col = 'pointsConvertedBalance' in where ? 'pointsConvertedBalance' : 'pointsBalance';
          if (!(state[col as keyof typeof state] >= where[col].gte)) return { count: 0 };
          state[col as keyof typeof state] -= data[col].decrement;
          return { count: 1 };
        }),
      },
      pointsTransaction: {
        create: jest.fn(async ({ data }: any) => {
          entries.push(data);
          return { id: `ptx${entries.length}` };
        }),
        findMany: jest.fn(async ({ where }: any) => entries.filter((e) => e.userId === where.userId && e.reason === where.reason)),
      },
      plantedTree: {
        create: jest.fn(async ({ data }: any) => {
          trees.push(data);
          return data;
        }),
        findUnique: jest.fn(async ({ where }: any) => trees.find((t) => t.certificateCode === where.certificateCode) ?? null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn(async () => [{ pointsBalance: state.pointsBalance, pointsConvertedBalance: state.pointsConvertedBalance }]),
    });
    return { prisma, state, entries, trees };
  }

  /** Điểm đang khoá của đơn còn trong hạn đổi/trả (lockedOrderPoints); 0 = không có đơn nào đang khoá. */
  function loyaltyWithLock(locked = 0) {
    return {
      lockedOrderPoints: jest.fn(async () => ({ locked, lockedReturn: 0, lockedUntil: null })),
      lockedPointsMessage: () => 'điểm từ đơn mới giao dùng được sau hạn đổi/trả',
    } as unknown as LoyaltyService;
  }
  const buyService = (prisma: PrismaService, config = makeConfig(), loyalty = loyaltyWithLock()) =>
    new GameService(prisma, config, analytics, undefined, undefined, undefined, loyalty);

  // C-009 (Q-02): 500đ Ví → 600 xu → 600💧 → coupon thu hoạch 30k. Chủ dự án chốt bỏ hẳn mua nước
  // bằng xu; route vẫn giữ để client cũ nhận lỗi rõ thay vì 404.
  it('mua nước đã ngừng → GoneException rõ ràng, không nhắc "xu", KHÔNG cộng giọt', async () => {
    const { prisma } = buyPrisma({ pointsBalance: 0, pointsConvertedBalance: 0 });
    const svc = new GameService(prisma, makeConfig(), analytics);
    await expect(svc.buySeeds('u1', 50)).rejects.toBeInstanceOf(GoneException);
    const err = await svc.buySeeds('u1', 50).catch((e: unknown) => e as Error);
    expect(err.message).toMatch(/ngừng/);
    expect(err.message).not.toMatch(/\bxu\b/i);
    expect(prisma.gameProfile.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('PD-3: góp quỹ = game.tree_points_price (mặc định 50) Điểm Xanh, đủ lô STANDARD → chỉ trừ STANDARD', async () => {
    const { prisma, state, entries } = buyPrisma({ pointsBalance: 80, pointsConvertedBalance: 100 });
    const svc = buyService(prisma);
    const r = await svc.buyTree('u1');
    expect(r).toMatchObject({ cost: 50, pointsUsed: 50, pointsUsedConverted: 0 });
    expect(r.certificateCode).toMatch(/^TUBU-/);
    expect(state).toEqual({ pointsBalance: 30, pointsConvertedBalance: 100 });
    expect(entries).toEqual([
      expect.objectContaining({ delta: -50, lot: 'STANDARD', reason: `GAME_BUY_TREE:${r.certificateCode}`, refType: 'GAME' }),
    ]);
    expect((prisma.plantedTree.create as jest.Mock).mock.calls[0][0].data.certificateCode).toBe(r.certificateCode);
  });

  it('PD-3 (OQ-5): STANDARD thiếu → tiêu hết STANDARD rồi phần còn lại từ lô quy đổi, 2 dòng sổ đúng lô', async () => {
    const { prisma, state, entries } = buyPrisma({ pointsBalance: 20, pointsConvertedBalance: 100 });
    const svc = buyService(prisma, makeConfig({ 'game.tree_points_price': 50 }));
    const r = await svc.buyTree('u1');
    expect(r).toMatchObject({ cost: 50, pointsUsed: 50, pointsUsedConverted: 30 });
    expect(state).toEqual({ pointsBalance: 0, pointsConvertedBalance: 70 });
    expect(entries.map((e) => [e.lot, e.delta])).toEqual([
      ['STANDARD', -20],
      ['CONVERTED', -30],
    ]);
  });

  it('PD-3: tổng hai lô không đủ → 400, không trừ gì, không tạo PlantedTree', async () => {
    const { prisma, state, entries } = buyPrisma({ pointsBalance: 20, pointsConvertedBalance: 29 });
    const svc = buyService(prisma);
    await expect(svc.buyTree('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(state).toEqual({ pointsBalance: 20, pointsConvertedBalance: 29 });
    expect(entries).toHaveLength(0);
    expect(prisma.plantedTree.create).not.toHaveBeenCalled();
  });

  it('PD-3: khoá dòng user (FOR UPDATE) trước khi chia lô', async () => {
    const { prisma } = buyPrisma({ pointsBalance: 80, pointsConvertedBalance: 0 });
    await buyService(prisma).buyTree('u1');
    const raw = (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw;
    expect((raw.mock.calls[0][0] as string[]).join('?')).toMatch(/FROM "users"[\s\S]*FOR UPDATE/);
  });

  it('review C1: điểm thường đang khoá không bị tiêu, phần còn lại lấy từ lô quy đổi (đọc khoá SAU khi khoá dòng user)', async () => {
    const { prisma, state, entries } = buyPrisma({ pointsBalance: 80, pointsConvertedBalance: 100 });
    const loyalty = loyaltyWithLock(60);
    const r = await buyService(prisma, makeConfig(), loyalty).buyTree('u1');
    // 80 − 60 khoá = 20 dùng được → thường 20, quy đổi 30.
    expect(r).toMatchObject({ pointsUsed: 50, pointsUsedConverted: 30 });
    expect(state).toEqual({ pointsBalance: 60, pointsConvertedBalance: 70 });
    expect(entries.map((e) => [e.lot, e.delta])).toEqual([
      ['STANDARD', -20],
      ['CONVERTED', -30],
    ]);
    expect((loyalty.lockedOrderPoints as jest.Mock).mock.calls[0][0]).toBe('u1');
  });

  it('review C1: toàn bộ điểm thường đang khoá và không có điểm quy đổi → 400 kèm lý do khoá, không trừ gì', async () => {
    const { prisma, state, entries } = buyPrisma({ pointsBalance: 60, pointsConvertedBalance: 0 });
    const err = await buyService(prisma, makeConfig(), loyaltyWithLock(60))
      .buyTree('u1')
      .then(() => new Error('không ném lỗi'), (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/Cần 50 Điểm Xanh/);
    expect(err.message).toMatch(/chưa dùng được/);
    expect(state).toEqual({ pointsBalance: 60, pointsConvertedBalance: 0 });
    expect(entries).toHaveLength(0);
    expect(prisma.plantedTree.create).not.toHaveBeenCalled();
  });

  it('review C1: dựng GameService không có LoyaltyService thì góp quỹ ném lỗi (không âm thầm bỏ qua khoá), không trừ gì', async () => {
    const { prisma, state } = buyPrisma({ pointsBalance: 80, pointsConvertedBalance: 0 });
    await expect(new GameService(prisma, makeConfig(), analytics).buyTree('u1')).rejects.toThrow(/LoyaltyService/);
    expect(state).toEqual({ pointsBalance: 80, pointsConvertedBalance: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  /**
   * OQ-5: bấm đôi nút góp quỹ không được thành hai lượt. Có Idempotency-Key thì mã chứng nhận suy ra tất định
   * từ (user, key) và lần gọi lại trả đúng kết quả lượt đầu; race thật ở test/integration-race/game-tree-idempotency.
   */
  describe('Idempotency-Key', () => {
    const KEY = 'tree-buy-key-0001';

    it('có key: mã chứng nhận suy ra tất định từ (user, key), dòng sổ mang đúng mã đó', async () => {
      const { prisma, entries } = buyPrisma({ pointsBalance: 80, pointsConvertedBalance: 0 });
      const r = await buyService(prisma).buyTree('u1', KEY);
      expect(r.certificateCode).toBe(treeCertificateCodeFor('u1', KEY));
      expect(entries).toEqual([expect.objectContaining({ reason: `GAME_BUY_TREE:${r.certificateCode}`, userId: 'u1' })]);
    });

    it('gọi lại cùng (user, key): trả ĐÚNG kết quả lượt đầu, KHÔNG trừ thêm, KHÔNG tạo cây thứ hai', async () => {
      const { prisma, state, entries, trees } = buyPrisma({ pointsBalance: 80, pointsConvertedBalance: 0 });
      const svc = buyService(prisma);
      const first = await svc.buyTree('u1', KEY);
      const second = await svc.buyTree('u1', KEY);
      expect(second).toEqual(first);
      expect(state).toEqual({ pointsBalance: 30, pointsConvertedBalance: 0 });
      expect(entries).toHaveLength(1);
      expect(trees).toHaveLength(1);
      expect(prisma.plantedTree.create).toHaveBeenCalledTimes(1);
    });

    it('replay trả đúng phần quy đổi và giá của lượt đầu dù giá cấu hình đã đổi sau đó', async () => {
      const { prisma, state } = buyPrisma({ pointsBalance: 20, pointsConvertedBalance: 100 });
      const first = await buyService(prisma, makeConfig({ 'game.tree_points_price': 50 })).buyTree('u1', KEY);
      expect(first).toMatchObject({ cost: 50, pointsUsed: 50, pointsUsedConverted: 30 });
      const replay = await buyService(prisma, makeConfig({ 'game.tree_points_price': 80 })).buyTree('u1', KEY);
      expect(replay).toEqual(first);
      expect(state).toEqual({ pointsBalance: 0, pointsConvertedBalance: 70 });
    });

    it('khoá dòng user (FOR UPDATE) TRƯỚC khi kiểm tra key đã dùng: hai request song song không cùng thấy "chưa có"', async () => {
      const { prisma } = buyPrisma({ pointsBalance: 80, pointsConvertedBalance: 0 });
      await buyService(prisma).buyTree('u1', KEY);
      const raw = (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw;
      const lookup = prisma.plantedTree.findUnique as jest.Mock;
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(raw.mock.invocationCallOrder[0]).toBeLessThan(lookup.mock.invocationCallOrder[0]!);
    });

    it('key khác nhau → hai lượt góp riêng với hai mã khác nhau', async () => {
      const { prisma, state } = buyPrisma({ pointsBalance: 200, pointsConvertedBalance: 0 });
      const svc = buyService(prisma);
      const a = await svc.buyTree('u1', KEY);
      const b = await svc.buyTree('u1', 'tree-buy-key-0002');
      expect(a.certificateCode).not.toBe(b.certificateCode);
      expect(state.pointsBalance).toBe(100);
    });

    it('thiếu điểm với key → 400, không để lại cây hay dòng sổ; nạp thêm rồi dùng lại CÙNG key thì góp được', async () => {
      const { prisma, state, entries, trees } = buyPrisma({ pointsBalance: 20, pointsConvertedBalance: 0 });
      const svc = buyService(prisma);
      await expect(svc.buyTree('u1', KEY)).rejects.toBeInstanceOf(BadRequestException);
      expect(entries).toHaveLength(0);
      expect(trees).toHaveLength(0);
      state.pointsBalance = 80;
      const r = await svc.buyTree('u1', KEY);
      expect(r.pointsUsed).toBe(50);
      expect(trees).toHaveLength(1);
    });

    it('mã suy ra từ key đã là của người dùng khác (va chạm/cố ý mài key) → 400, không trừ điểm, không lộ dữ liệu của họ', async () => {
      const { prisma, state, entries, trees } = buyPrisma({ pointsBalance: 80, pointsConvertedBalance: 0 });
      trees.push({ userId: 'someone-else', certificateCode: treeCertificateCodeFor('u1', KEY), treeType: 'Cây khác' });
      const err = await buyService(prisma)
        .buyTree('u1', KEY)
        .then(() => new Error('không ném lỗi'), (e: unknown) => e as Error);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).not.toMatch(/someone-else|Cây khác/);
      expect(state.pointsBalance).toBe(80);
      expect(entries).toHaveLength(0);
      expect(prisma.plantedTree.create).not.toHaveBeenCalled();
    });

    it.each([
      ['rỗng', ''],
      ['ngắn hơn 8 ký tự', 'abc1234'],
      ['dài hơn 128 ký tự', 'a'.repeat(129)],
      ['có khoảng trắng', 'tree buy key 0001'],
      ['có dấu hai chấm (tách được thành "user:key" khác)', 'tree:buy:key:0001'],
      ['có ký tự ngoài ASCII', 'tree-buy-key-0001-đ'],
    ])('key %s → 400 tiếng Việt, không mở transaction, không trừ gì', async (_name, bad) => {
      const { prisma, state } = buyPrisma({ pointsBalance: 80, pointsConvertedBalance: 0 });
      const err = await buyService(prisma)
        .buyTree('u1', bad)
        .then(() => new Error('không ném lỗi'), (e: unknown) => e as Error);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Idempotency-Key/);
      expect(err.message).toMatch(/8.+128/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(state.pointsBalance).toBe(80);
    });

    it('key đúng ở hai biên 8 và 128 ký tự được nhận', async () => {
      const { prisma } = buyPrisma({ pointsBalance: 200, pointsConvertedBalance: 0 });
      const svc = buyService(prisma);
      await expect(svc.buyTree('u1', 'a-_Z0129')).resolves.toMatchObject({ cost: 50 });
      await expect(svc.buyTree('u1', 'k'.repeat(128))).resolves.toMatchObject({ cost: 50 });
    });

    it('không key: như cũ, mã ngẫu nhiên mỗi lần, không tra bản ghi cũ', async () => {
      const { prisma, state } = buyPrisma({ pointsBalance: 200, pointsConvertedBalance: 0 });
      const svc = buyService(prisma);
      const a = await svc.buyTree('u1');
      const b = await svc.buyTree('u1');
      expect(a.certificateCode).not.toBe(b.certificateCode);
      expect(a.certificateCode).toMatch(/^TUBU-[0-9A-F]{8}$/);
      expect(state.pointsBalance).toBe(100);
      expect(prisma.plantedTree.findUnique).not.toHaveBeenCalled();
    });
  });

  it('getProfile trả spinCostPoints theo game.spin_buy_cost_points (mặc định 10)', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile());
    const custom = (await new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 20 }), analytics).getProfile('u1')) as Record<string, unknown>;
    expect(custom.spinCostPoints).toBe(20);
    const def = (await new GameService(prisma, makeConfig(), analytics).getProfile('u1')) as Record<string, unknown>;
    expect(def.spinCostPoints).toBe(10);
  });

  it('PD-3: getProfile trả treePointsPrice, bỏ xuPerSeed/treeXuPrice', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile());
    const r = (await new GameService(prisma, makeConfig({ 'game.tree_points_price': 50 }), analytics).getProfile('u1')) as Record<string, unknown>;
    expect(r.treePointsPrice).toBe(50);
    expect(r).not.toHaveProperty('xuPerSeed');
    expect(r).not.toHaveProperty('treeXuPrice');
  });
});

describe('GameService.getMissions', () => {
  const MISSIONS = [
    { id: 'm1', code: 'CHECKIN_7', title: 'Chăm chỉ 7 ngày', goal: 7, rewardPoints: 30, isRepeatable: true },
    { id: 'm2', code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', goal: 1, rewardPoints: 20, isRepeatable: false },
    { id: 'm3', code: 'REVIEW_3', title: 'Nhà phê bình', goal: 3, rewardPoints: 15, isRepeatable: false },
    { id: 'm4', code: 'INVITE_3', title: 'Lan tỏa sống xanh', goal: 3, rewardPoints: 50, isRepeatable: false },
  ];

  it('tính toán tiến trình real-time cho từng nhiệm vụ; claimed=false khi chưa nhận', async () => {
    const prisma = makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 3 }) },
      order: { count: jest.fn().mockResolvedValue(1) },
      review: { count: jest.fn().mockResolvedValue(2) },
      user: { count: jest.fn().mockResolvedValue(0) },
      mission: { findMany: jest.fn().mockResolvedValue(MISSIONS) },
      missionProgress: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const svc = new GameService(prisma, makeConfig(), analytics);
    const res = await svc.getMissions('u1');
    expect(res).toEqual([
      { code: 'CHECKIN_7', title: 'Chăm chỉ 7 ngày', description: undefined, rewardPoints: 30, progress: 3, goal: 7, completed: false, claimed: false },
      { code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', description: undefined, rewardPoints: 20, progress: 1, goal: 1, completed: true, claimed: false },
      { code: 'REVIEW_3', title: 'Nhà phê bình', description: undefined, rewardPoints: 15, progress: 2, goal: 3, completed: false, claimed: false },
      { code: 'INVITE_3', title: 'Lan tỏa sống xanh', description: undefined, rewardPoints: 50, progress: 0, goal: 3, completed: false, claimed: false },
    ]);
  });

  it('A1-02: nhiệm vụ đã có dòng mission_progress khớp (missionId, cycleKey hiện tại) → claimed=true', async () => {
    const prisma = makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 0 }) },
      order: { count: jest.fn().mockResolvedValue(1) }, // FIRST_ORDER: raw=1, goal=1 → cycleKey '0' (không lặp lại)
      review: { count: jest.fn().mockResolvedValue(0) },
      user: { count: jest.fn().mockResolvedValue(0) },
      mission: { findMany: jest.fn().mockResolvedValue(MISSIONS) },
      missionProgress: { findMany: jest.fn().mockResolvedValue([{ missionId: 'm2', cycleKey: '0' }]) },
    });
    const svc = new GameService(prisma, makeConfig(), analytics);
    const res = await svc.getMissions('u1');
    const firstOrder = res.find((m) => m.code === 'FIRST_ORDER')!;
    expect(firstOrder.completed).toBe(true);
    expect(firstOrder.claimed).toBe(true);
  });

  it('nhiệm vụ lặp lại (CHECKIN_7): dòng mission_progress của chu kỳ CŨ (cycleKey 0) không đánh dấu claimed cho chu kỳ MỚI (streak 14 → cycleKey 1)', async () => {
    const prisma = makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 14 }) },
      order: { count: jest.fn().mockResolvedValue(0) },
      review: { count: jest.fn().mockResolvedValue(0) },
      user: { count: jest.fn().mockResolvedValue(0) },
      mission: { findMany: jest.fn().mockResolvedValue(MISSIONS) },
      missionProgress: { findMany: jest.fn().mockResolvedValue([{ missionId: 'm1', cycleKey: '0' }]) },
    });
    const svc = new GameService(prisma, makeConfig(), analytics);
    const res = await svc.getMissions('u1');
    const checkin = res.find((m) => m.code === 'CHECKIN_7')!;
    expect(checkin.completed).toBe(true);
    expect(checkin.claimed).toBe(false); // chu kỳ mới (1) chưa nhận, dù chu kỳ cũ (0) đã nhận
  });
});

describe('GameService.claimMission', () => {
  function missionsPrisma(over: Record<string, unknown> = {}) {
    return makePrisma({
      mission: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'm2', code: 'FIRST_ORDER', goal: 1, rewardPoints: 20, isRepeatable: false, rewardCoupon: null }),
      },
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 0 }) },
      order: { count: jest.fn().mockResolvedValue(1) },
      review: { count: jest.fn().mockResolvedValue(0) },
      ...over,
    });
  }

  it('nhiệm vụ không tồn tại → NotFoundException', async () => {
    const prisma = missionsPrisma({ mission: { findUnique: jest.fn().mockResolvedValue(null) } });
    const svc = new GameService(prisma, makeConfig(), analytics);
    await expect(svc.claimMission('u1', 'NOPE')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chưa đủ điều kiện (raw < goal) → BadRequest, KHÔNG insert mission_progress, KHÔNG cộng điểm', async () => {
    const missionProgressCreate = jest.fn();
    const pointsCreate = jest.fn();
    const prisma = missionsPrisma({
      order: { count: jest.fn().mockResolvedValue(0) }, // FIRST_ORDER goal=1, raw=0 → chưa đạt
      missionProgress: { create: missionProgressCreate },
      pointsTransaction: { create: pointsCreate },
    });
    const svc = new GameService(prisma, makeConfig(), analytics);
    await expect(svc.claimMission('u1', 'FIRST_ORDER')).rejects.toThrow(BadRequestException);
    expect(missionProgressCreate).not.toHaveBeenCalled();
    expect(pointsCreate).not.toHaveBeenCalled();
  });

  it('đủ điều kiện, chưa nhận → cộng đúng rewardPoints vào Điểm Xanh (pointsBalance) đúng 1 lần + ghi mission_progress', async () => {
    const missionProgressCreate = jest.fn().mockResolvedValue({ id: 'mp1' });
    const pointsCreate = jest.fn().mockResolvedValue({});
    const userUpdate = jest.fn().mockResolvedValue({});
    const prisma = missionsPrisma({
      missionProgress: { create: missionProgressCreate },
      pointsTransaction: { create: pointsCreate },
      user: { count: jest.fn().mockResolvedValue(0), update: userUpdate },
    });
    const svc = new GameService(prisma, makeConfig(), analytics);
    const res = await svc.claimMission('u1', 'FIRST_ORDER');

    expect(res).toEqual({ claimed: true, rewardPoints: 20, couponCode: null });
    expect(missionProgressCreate).toHaveBeenCalledWith({
      data: { userId: 'u1', missionId: 'm2', cycleKey: '0', progress: 1, goal: 1, completedAt: expect.any(Date) },
    });
    expect(pointsCreate).toHaveBeenCalledTimes(1);
    expect(pointsCreate).toHaveBeenCalledWith({ data: { userId: 'u1', delta: 20, reason: 'MISSION:FIRST_ORDER:0', refType: 'GAME' } });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsBalance: { increment: 20 } } });
  });

  it('đã nhận rồi (unique userId+missionId+cycleKey → P2002) → BadRequest "đã nhận", KHÔNG cộng thêm điểm', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const missionProgressCreate = jest.fn().mockRejectedValue(p2002);
    const pointsCreate = jest.fn();
    const prisma = missionsPrisma({
      missionProgress: { create: missionProgressCreate },
      pointsTransaction: { create: pointsCreate },
    });
    const svc = new GameService(prisma, makeConfig(), analytics);

    await expect(svc.claimMission('u1', 'FIRST_ORDER')).rejects.toThrow(/đã nhận/i);
    expect(pointsCreate).not.toHaveBeenCalled();
  });

  /** Mirror kiểu test race của AffiliateService.claimMilestone / SeasonPassService.claim: 2 request
   * claim gần như đồng thời cùng nhiệm vụ — chỉ 1 request được cộng thưởng, request kia rơi vào
   * nhánh P2002 → BadRequest, không cộng thêm. */
  it('2 request claim gần như đồng thời cùng nhiệm vụ → chỉ cộng điểm đúng 1 lần', async () => {
    let committed = false;
    let inflight: Promise<void> | null = null;
    const tick = () => new Promise((r) => setImmediate(r));
    let pointsTotal = 0;

    const $transaction = async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      let settle!: () => void;
      const done = new Promise<void>((r) => (settle = r));
      let iAmHolder = false;
      const tx = {
        missionProgress: {
          create: async () => {
            for (;;) {
              if (committed) {
                const e: Error & { code?: string } = new Error('Unique constraint failed');
                e.code = 'P2002';
                throw e;
              }
              if (!inflight) break;
              await inflight;
            }
            inflight = done;
            iAmHolder = true;
            await tick(); // nhường lượt để request kia cũng chạy tới cùng bước
            return { id: 'mp1' };
          },
        },
        pointsTransaction: {
          create: async () => {
            pointsTotal += 20;
            return {};
          },
        },
        user: { update: async () => ({}) },
      };
      try {
        const out = await cb(tx);
        if (iAmHolder) committed = true;
        return out;
      } finally {
        if (iAmHolder) {
          inflight = null;
          settle();
        }
      }
    };

    const prisma = missionsPrisma({ $transaction });
    const svc = new GameService(prisma, makeConfig(), analytics);

    const results = await Promise.allSettled([svc.claimMission('u1', 'FIRST_ORDER'), svc.claimMission('u1', 'FIRST_ORDER')]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(BadRequestException);
    expect(pointsTotal).toBe(20);
  });

  it('nhiệm vụ lặp lại (CHECKIN_7): streak=7 → cycleKey "1" (chu kỳ thứ 2, chu kỳ 0 là chưa từng đạt goal)', async () => {
    const missionProgressCreate = jest.fn().mockResolvedValue({ id: 'mp1' });
    const prisma = missionsPrisma({
      mission: {
        findUnique: jest.fn().mockResolvedValue({ id: 'm1', code: 'CHECKIN_7', goal: 7, rewardPoints: 30, isRepeatable: true, rewardCoupon: null }),
      },
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 7 }) },
      missionProgress: { create: missionProgressCreate },
    });
    const svc = new GameService(prisma, makeConfig(), analytics);
    await svc.claimMission('u1', 'CHECKIN_7');
    expect(missionProgressCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cycleKey: '1' }) }),
    );
  });
});

describe('GameService.pickWeighted (phân phối theo trọng số)', () => {
  type Prize = { id: string; name: string; weight: number; rewardType: string; value: number };
  const pick = (prizes: Prize[], rand: number) => {
    jest.spyOn(Math, 'random').mockReturnValue(rand);
    const svc = new GameService(makePrisma(), makeConfig(), analytics) as unknown as { pickWeighted(p: Prize[]): Prize };
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

// C-026: trần coupon thu hoạch "trong ngày" đếm từ 00:00 giờ VN dù host chạy UTC.
describe('GameService.waterTree — đầu ngày theo giờ VN (C-026)', () => {
  it('01:30 ngày 10/3 giờ VN → đếm coupon từ 2026-03-09T17:00Z', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 30, treeType: 't', treesPlanted: 0 } }),
    );
    jest.useFakeTimers().setSystemTime(new Date('2026-03-09T18:30:00Z'));
    try {
      await new GameService(prisma, makeConfig(), analytics).waterTree('u1', 30);
    } finally {
      jest.useRealTimers();
    }
    const where = (prisma.coupon.count as jest.Mock).mock.calls[0][0].where;
    expect(where.startAt.gte.toISOString()).toBe('2026-03-09T17:00:00.000Z');
  });
});

// C-040: đặc tả che tên bản chép tay `maskName` (cùng công thức ở game, game-gift, game-season).
// Khác bản `maskFullName` ở merchant: chỉ tách theo dấu cách ' ' (tab/nbsp không tách) và tên
// toàn khoảng trắng ra "***" thay vì tên mặc định.
const MASK_NAME_CASES: [string, string | null, string][] = [
  ['null -> mặc định', null, 'Bạn Tubu'],
  ['rỗng -> mặc định', '', 'Bạn Tubu'],
  ['chỉ khoảng trắng -> "***"', '   ', '***'],
  ['một từ', 'Long', 'Long***'],
  ['nhiều từ -> từ cuối', 'Lã Hoàng Long', 'Long***'],
  ['thừa khoảng trắng đầu/cuối', '  Nguyễn An  ', 'An***'],
  ['hai dấu cách liền nhau', 'Lã  Long', 'Long***'],
  ['tab giữa tên -> không tách', 'Lã\tLong', 'Lã\tLong***'],
  ['nbsp giữa tên -> không tách', 'Lã\u00a0Long', 'Lã\u00a0Long***'],
];

describe('GameService.getLeaderboard — che tên (đặc tả maskName, C-040)', () => {
  it.each(MASK_NAME_CASES)('%s', async (_label, fullName, expected) => {
    const prisma = makePrisma({
      gameProfile: {
        findMany: jest.fn().mockResolvedValue([
          { longestStreak: 7, ecoImpact: { treesPlanted: 3 }, user: { fullName } },
        ]),
      },
    });
    const r = await new GameService(prisma, makeConfig(), analytics).getLeaderboard();
    expect(r).toEqual([{ rank: 1, nickname: expected, streak: 7, treesPlanted: 3 }]);
  });
});
