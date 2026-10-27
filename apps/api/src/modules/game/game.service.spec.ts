import { BadRequestException, ForbiddenException, GoneException, Logger, NotFoundException } from '@nestjs/common';
import { GameService } from './game.service';
import { treeCertificateCodeFor } from './tree-purchase-key';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import { startOfVnMonth } from '../../common/vn-time';

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

/** Hạn cố định do stub `pointsExpiresAt` trả; test kiểm đúng giá trị này được ghi vào dòng sổ. */
const REWARD_EXPIRES_AT = new Date('2027-10-11T00:00:00.000Z');

/** Cửa sổ đổi/trả mà stub `returnWindowDays` trả: khác mặc định 7 để test thấy đúng giá trị này được truyền đi. */
const WINDOW_DAYS = 9;

/**
 * Bọc `$transaction` của stub để biết lúc nào tx đang mở, và dựng config ghi lại từng lần `get` kèm cờ "đang trong tx".
 * Lần trượt cache của `get` trong tx xin thêm một kết nối pool khi tx đang giữ một (PF-6a).
 */
function trackTx(prisma: PrismaService, overrides: Record<string, unknown> = {}) {
  const state = { txOpen: false };
  const configGets: { key: string; inTx: boolean }[] = [];
  const run = (prisma.$transaction as jest.Mock).getMockImplementation()!;
  (prisma.$transaction as jest.Mock).mockImplementation(async (cb: unknown, ...rest: unknown[]) => {
    state.txOpen = true;
    try {
      return await run(cb, ...rest);
    } finally {
      state.txOpen = false;
    }
  });
  const base = makeConfig(overrides);
  const config = {
    get: jest.fn(async <T>(key: string, fallback?: T): Promise<T> => {
      configGets.push({ key, inTx: state.txOpen });
      return base.get<T>(key, fallback);
    }),
  } as unknown as SystemConfigService;
  return { config, configGets };
}

/**
 * LoyaltyService chỉ với `pointsExpiresAt` (helper hạn dùng chung của điểm danh, điểm hoàn, POS, PE-3) và hai hàm đọc
 * điểm đang khoá của đơn còn trong hạn đổi/trả (PF-5a); `locked` = số điểm đang khoá, 0 là không có đơn nào khoá.
 */
function loyaltyWithExpiry(locked = 0) {
  const pointsExpiresAt = jest.fn(async (_from: Date) => REWARD_EXPIRES_AT);
  const lockedOrderPoints = jest.fn(async (..._args: unknown[]) => ({ locked, lockedReturn: 0, lockedUntil: null }));
  const lockedPointsMessage = jest.fn(() => 'điểm từ đơn mới giao dùng được sau hạn đổi/trả');
  const returnWindowDays = jest.fn(async () => WINDOW_DAYS);
  return {
    loyalty: { pointsExpiresAt, lockedOrderPoints, lockedPointsMessage, returnWindowDays } as unknown as LoyaltyService,
    pointsExpiresAt,
    lockedOrderPoints,
    returnWindowDays,
  };
}

/** Số dư Điểm Xanh thường mà câu `SELECT ... FOR UPDATE` của spin đọc được. */
function withBalance(prisma: PrismaService, pointsBalance: number) {
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ pointsBalance }]);
}

/** Prisma stub linh hoạt — chỉ những bảng GameService dùng. */
function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    gameProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ zaloId: 'zalo-u1' }),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    pointsTransaction: { create: jest.fn(), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    coinTransaction: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([{ pointsBalance: 100 }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    gameSpin: { create: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
    gameQuiz: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    gameQuizAttempt: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), create: jest.fn().mockResolvedValue({}) },
    coupon: { create: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
    plantedTree: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    mission: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    missionProgress: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    order: { findMany: jest.fn().mockResolvedValue([]) },
    returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
    // Dòng trả đã duyệt (REVIEW_3 bỏ đánh giá của sản phẩm đã bị trả); mặc định chưa có.
    returnRequestItem: { findMany: jest.fn().mockResolvedValue([]) },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    variation: { findMany: jest.fn().mockResolvedValue([]) },
    review: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (cbOrArr: unknown) => {
      if (typeof cbOrArr === 'function') return (cbOrArr as (tx: unknown) => unknown)(res);
      return [];
    }),
  };
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = (base as Record<string, unknown>)[k];
    const isObj = (x: unknown) => typeof x === 'object' && x !== null && !Array.isArray(x);
    merged[k] = isObj(b) && isObj(v) ? { ...(b as object), ...(v as object) } : v;
  }
  const res = merged as unknown as PrismaService;
  return res;
}

const DAY_MS = 864e5;

/** Chỉ giả Date (không đụng setTimeout/microtask) để async của service chạy bình thường. */
const NO_FAKE = [
  'nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
  'queueMicrotask', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'cancelIdleCallback', 'hrtime',
] as const;
function freezeNow(iso: string) {
  jest.useFakeTimers({ now: new Date(iso), doNotFake: [...NO_FAKE] });
}

/** Đơn bán lẻ đã giao `daysAgo` ngày trước, như dòng order.findMany của missionMetrics. */
const deliveredOrder = (id: string, daysAgo: number) => {
  const at = new Date(Date.now() - daysAgo * DAY_MS);
  return { id, deliveredAt: at, updatedAt: at };
};

/** n đơn đã giao từ 30 ngày trước (o1..on), qua hạn đổi/trả mặc định 7 ngày. */
const settledOrders = (n: number) => ({
  findMany: jest.fn().mockResolvedValue(Array.from({ length: n }, (_, i) => deliveredOrder(`o${i + 1}`, 30))),
});

/** Đánh giá có ảnh của khách: mỗi dòng một sản phẩm khác nhau (p1..pn) trên đơn o1..on. */
const reviewedProducts = (n: number) => Array.from({ length: n }, (_, i) => ({ productId: `p${i + 1}`, orderId: `o${i + 1}` }));

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

  const spinWith = (prisma: PrismaService, loyalty: LoyaltyService, overrides: Record<string, unknown> = {}) =>
    new GameService(
      prisma,
      makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES, ...overrides }),
      analytics,
      undefined,
      undefined,
      undefined,
      loyalty,
    );

  it('không đủ điểm → 400 "Cần 10 Điểm Xanh", không trừ điểm, không ghi sổ, không ghi lượt quay', async () => {
    const prisma = makePrisma();
    withBalance(prisma, 5);
    const err = await spinWith(prisma, loyaltyWithExpiry().loyalty)
      .spin('u1')
      .then(() => new Error('không ném lỗi'), (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('Cần 10 Điểm Xanh để quay.');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    expect(prisma.gameSpin.create).not.toHaveBeenCalled();
  });

  it('chưa cấu hình giải → ném lỗi (sau khi đã hoàn điểm? không — kiểm tra trước trừ)', async () => {
    const prisma = makePrisma();
    withBalance(prisma, 100);
    await expect(spinWith(prisma, loyaltyWithExpiry().loyalty, { 'game.spin_prizes': [] }).spin('u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled(); // chưa trừ điểm
  });

  // PF-5a: spin tiêu điểm thường nên phải chặn điểm đơn còn trong hạn đổi/trả như checkout, đổi voucher, góp quỹ.
  describe('điểm đang khoá của đơn còn trong hạn đổi/trả (PF-5a)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('toàn bộ số dư (20) là điểm khoá, phí 10 → 400 kèm lý do khoá, không trừ gì, không ghi sổ/lượt quay', async () => {
      const prisma = makePrisma();
      withBalance(prisma, 20);
      const { loyalty } = loyaltyWithExpiry(20);
      const err = await spinWith(prisma, loyalty)
        .spin('u1')
        .then(() => new Error('không ném lỗi'), (e: unknown) => e as Error);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/^Cần 10 Điểm Xanh để quay\./);
      expect(err.message).toMatch(/Một phần điểm chưa dùng được: điểm từ đơn mới giao dùng được sau hạn đổi\/trả\./);
      expect(loyalty.lockedPointsMessage).toHaveBeenCalledTimes(1);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
      expect(prisma.gameSpin.create).not.toHaveBeenCalled();
    });

    it('dùng được = số dư − điểm khoá: 25 − 20 = 5 < 10 → từ chối; 35 − 20 = 15 ≥ 10 → quay, guard atomic có cộng điểm khoá', async () => {
      const rejected = makePrisma();
      withBalance(rejected, 25);
      await expect(spinWith(rejected, loyaltyWithExpiry(20).loyalty).spin('u1')).rejects.toBeInstanceOf(BadRequestException);
      expect(rejected.user.updateMany).not.toHaveBeenCalled();

      const accepted = makePrisma();
      withBalance(accepted, 35);
      jest.spyOn(Math, 'random').mockReturnValue(0.9); // giải 'b' (NONE)
      await spinWith(accepted, loyaltyWithExpiry(20).loyalty).spin('u1');
      expect((accepted.user.updateMany as jest.Mock).mock.calls[0][0]).toEqual({
        where: { id: 'u1', pointsBalance: { gte: 30 } },
        data: { pointsBalance: { decrement: 10 } },
      });
      expect((accepted.pointsTransaction.create as jest.Mock).mock.calls.map((c) => c[0].data)).toEqual([
        { userId: 'u1', delta: -10, reason: 'GAME_SPIN_COST', refType: 'GAME' },
      ]);
    });

    it('khoá dòng user (FOR UPDATE) TRƯỚC khi đọc điểm khoá, điểm khoá được đọc bằng ĐÚNG tx, rồi mới trừ điểm', async () => {
      const prisma = makePrisma();
      jest.spyOn(Math, 'random').mockReturnValue(0.9);
      const { loyalty, lockedOrderPoints } = loyaltyWithExpiry(0);
      await spinWith(prisma, loyalty).spin('u1');
      const raw = prisma.$queryRaw as jest.Mock;
      expect((raw.mock.calls[0][0] as string[]).join('?')).toMatch(/FROM "users"[\s\S]*FOR UPDATE/);
      expect(lockedOrderPoints.mock.calls[0]![0]).toBe('u1');
      expect(lockedOrderPoints.mock.calls[0]![2]).toBe(prisma); // tx của $transaction mock chính là prisma stub
      const order = (m: jest.Mock) => m.mock.invocationCallOrder[0]!;
      expect(order(raw)).toBeLessThan(order(lockedOrderPoints));
      expect(order(lockedOrderPoints)).toBeLessThan(order(prisma.user.updateMany as jest.Mock));
      expect(order(prisma.user.updateMany as jest.Mock)).toBeLessThan(order(prisma.gameSpin.count as jest.Mock));
    });

    it('PF-6a (b): cửa sổ đổi/trả đọc NGOÀI tx (loyalty.returnWindowDays trước $transaction), truyền vào lockedOrderPoints; không có lần đọc cấu hình nào trong tx', async () => {
      const prisma = makePrisma();
      jest.spyOn(Math, 'random').mockReturnValue(0.9);
      const { loyalty, lockedOrderPoints, returnWindowDays } = loyaltyWithExpiry(0);
      const { config, configGets } = trackTx(prisma, { 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES });

      await new GameService(prisma, config, analytics, undefined, undefined, undefined, loyalty).spin('u1');

      expect(returnWindowDays).toHaveBeenCalledTimes(1);
      const opened = (prisma.$transaction as jest.Mock).mock.invocationCallOrder[0]!;
      expect(returnWindowDays.mock.invocationCallOrder[0]).toBeLessThan(opened);
      expect(lockedOrderPoints.mock.calls[0]![3]).toBe(WINDOW_DAYS);
      expect(configGets.filter((g) => g.inTx)).toEqual([]);
      // Việc đọc cửa sổ giao hết cho LoyaltyService (một nơi định nghĩa khoá và mặc định), GameService không đọc song song.
      expect(configGets.map((g) => g.key)).not.toContain('returns.window_days');
    });

    it('trúng giải SEEDS → cộng đủ, không đọc game.tank_capacity và không kẹp theo sức chứa bình', async () => {
      const prisma = makePrisma();
      jest.spyOn(Math, 'random').mockReturnValue(0);
      const prizes = [{ id: 's', name: '30 giọt', weight: 1, rewardType: 'SEEDS', value: 30 }];
      const { loyalty } = loyaltyWithExpiry(0);
      const { config, configGets } = trackTx(prisma, {
        'game.spin_buy_cost_points': 10,
        'game.spin_prizes': prizes,
        'game.tank_capacity': 250,
      });

      await new GameService(prisma, config, analytics, undefined, undefined, undefined, loyalty).spin('u1');

      expect(configGets.map((g) => g.key)).not.toContain('game.tank_capacity');
      expect(configGets.filter((g) => g.inTx)).toEqual([]);
      // Giải trả bằng Điểm Xanh: cộng đủ, không kẹp theo sức chứa bình.
      expect(prisma.gameProfile.updateMany).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('ENGAGE-17: trúng giải SEEDS khi chưa có hồ sơ vườn → upsert hồ sơ (không P2025), không kẹp', async () => {
      const prisma = makePrisma();
      jest.spyOn(Math, 'random').mockReturnValue(0);
      const prizes = [{ id: 's', name: '30 giọt', weight: 1, rewardType: 'SEEDS', value: 30 }];
      const upsert = prisma.gameProfile.upsert as jest.Mock;
      const svc = spinWith(prisma, loyaltyWithExpiry(0).loyalty, { 'game.spin_prizes': prizes, 'game.tank_capacity': 250 });

      await svc.spin('u1');

      expect(prisma.gameProfile.update).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        update: { totalSeeds: { increment: 30 } },
        create: {
          userId: 'u1',
          totalSeeds: 30,
          ecoImpact: { progress: 0, target: 60, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0, sproutRewarded: false },
        },
      });
      // Giải trả bằng Điểm Xanh: cộng đủ, không kẹp theo sức chứa bình.
      expect(prisma.gameProfile.updateMany).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('ENGAGE-10: voucher trúng vòng quay có đơn tối thiểu = giá trị × game.spin_voucher_min_order_multiplier (mặc định 6, như quà đổi điểm 50k/300k)', async () => {
      const prizes = [{ id: 'v', name: 'Voucher 20k', weight: 1, rewardType: 'COUPON', value: 20000 }];
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const prisma = makePrisma();
      await spinWith(prisma, loyaltyWithExpiry(0).loyalty, { 'game.spin_prizes': prizes }).spin('u1');
      expect((prisma.coupon.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ value: 20000, minOrder: 120000 });

      const prisma2 = makePrisma();
      await spinWith(prisma2, loyaltyWithExpiry(0).loyalty, {
        'game.spin_prizes': prizes,
        'game.spin_voucher_min_order_multiplier': 10,
      }).spin('u1');
      expect((prisma2.coupon.create as jest.Mock).mock.calls[0][0].data.minOrder).toBe(200000);

      const prisma3 = makePrisma();
      await spinWith(prisma3, loyaltyWithExpiry(0).loyalty, {
        'game.spin_prizes': prizes,
        'game.spin_voucher_min_order_multiplier': 'abc',
      }).spin('u1');
      expect((prisma3.coupon.create as jest.Mock).mock.calls[0][0].data.minOrder).toBe(120000);
    });

    // R2-ENGAGE-6: sheet kết quả cần mã, đơn tối thiểu và hạn dùng của voucher vừa trúng để khách biết dùng thế nào.
    it('R2-ENGAGE-6: trúng voucher → kết quả kèm mã, đơn tối thiểu và hạn dùng của chính coupon vừa tạo; giải khác không có coupon', async () => {
      const prizes = [{ id: 'v', name: 'Voucher 20k', weight: 1, rewardType: 'COUPON', value: 20000 }];
      jest.spyOn(Math, 'random').mockReturnValue(0);
      const prisma = makePrisma();
      const res = (await spinWith(prisma, loyaltyWithExpiry(0).loyalty, { 'game.spin_prizes': prizes }).spin('u1')) as {
        prize: { coupon?: { code: string; minOrder: number; expiresAt: Date } };
      };
      const created = (prisma.coupon.create as jest.Mock).mock.calls[0][0].data;
      expect(res.prize.coupon).toEqual({ code: created.code, minOrder: 120000, expiresAt: created.endAt });

      const prisma2 = makePrisma();
      const none = [{ id: 'n', name: 'Chúc may mắn', weight: 1, rewardType: 'NONE', value: 0 }];
      const res2 = (await spinWith(prisma2, loyaltyWithExpiry(0).loyalty, { 'game.spin_prizes': none }).spin('u1')) as { prize: object };
      expect(res2.prize).not.toHaveProperty('coupon');
    });

    it('PF-6a (b): trúng giải không phải SEEDS → không đọc game.tank_capacity', async () => {
      const prisma = makePrisma();
      jest.spyOn(Math, 'random').mockReturnValue(0.9); // giải 'b' (NONE)
      const { loyalty } = loyaltyWithExpiry(0);
      const { config, configGets } = trackTx(prisma, { 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES });

      await new GameService(prisma, config, analytics, undefined, undefined, undefined, loyalty).spin('u1');

      expect(configGets.map((g) => g.key)).not.toContain('game.tank_capacity');
    });

    describe('PF-6a: giải có thưởng không hợp lệ trong cấu hình đã lưu từ trước luật ghi', () => {
      const BAD_NEGATIVE = { id: 'bad', name: 'Trừ 50 điểm', weight: 100, rewardType: 'POINTS', value: -50 };
      const NONE = { id: 'none', name: 'Chúc may mắn', weight: 1, rewardType: 'NONE', value: 0 };

      it('giải POINTS value âm không bao giờ được chọn dù là giải đầu và trọng số lớn nhất: chỉ trừ phí quay, không có dòng thưởng, có log cảnh báo', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const prisma = makePrisma();
        jest.spyOn(Math, 'random').mockReturnValue(0); // pickWeighted chọn giải ĐẦU nếu nó còn trong danh sách
        const svc = spinWith(prisma, loyaltyWithExpiry(0).loyalty, { 'game.spin_prizes': [BAD_NEGATIVE, NONE] });

        const res = (await svc.spin('u1')) as { prize: { id: string } };

        expect(res.prize.id).toBe('none');
        expect((prisma.user.updateMany as jest.Mock).mock.calls.map((c) => c[0].data)).toEqual([{ pointsBalance: { decrement: 10 } }]);
        expect((prisma.pointsTransaction.create as jest.Mock).mock.calls.map((c) => c[0].data)).toEqual([
          { userId: 'u1', delta: -10, reason: 'GAME_SPIN_COST', refType: 'GAME' },
        ]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad'));
      });

      it.each([
        ['SEEDS value lẻ', { id: 'bad', name: 'x', weight: 100, rewardType: 'SEEDS', value: 2.5 }],
        ['COUPON value lẻ', { id: 'bad', name: 'x', weight: 100, rewardType: 'COUPON', value: 20000.5 }],
        ['COUPON value vượt cột Int của DB', { id: 'bad', name: 'x', weight: 100, rewardType: 'COUPON', value: 3e9 }],
        ['POINTS value vượt trần 100.000 Điểm Xanh (cấu hình lưu từ trước khi có trần)', { id: 'bad', name: 'x', weight: 100, rewardType: 'POINTS', value: 100_001 }],
      ])('%s không bao giờ được chọn dù là giải đầu và trọng số lớn nhất', async (_label, bad) => {
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const prisma = makePrisma();
        jest.spyOn(Math, 'random').mockReturnValue(0);
        const svc = spinWith(prisma, loyaltyWithExpiry(0).loyalty, { 'game.spin_prizes': [bad, NONE] });

        const res = (await svc.spin('u1')) as { prize: { id: string } };

        expect(res.prize.id).toBe('none');
        expect(prisma.coupon.create).not.toHaveBeenCalled();
        expect(prisma.gameProfile.update).not.toHaveBeenCalled();
      });

      it('chỉ còn giải không hợp lệ → "Vòng quay chưa cấu hình", không mở tx, không trừ điểm', async () => {
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const prisma = makePrisma();
        const svc = spinWith(prisma, loyaltyWithExpiry(0).loyalty, { 'game.spin_prizes': [BAD_NEGATIVE] });

        await expect(svc.spin('u1')).rejects.toThrow('Vòng quay chưa cấu hình.');

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.user.updateMany).not.toHaveBeenCalled();
      });

      it('log cảnh báo mỗi giải hỏng một lần cho mỗi bản cấu hình, không lặp ở các lượt quay sau', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        jest.spyOn(Math, 'random').mockReturnValue(0);
        const svc = spinWith(makePrisma(), loyaltyWithExpiry(0).loyalty, { 'game.spin_prizes': [BAD_NEGATIVE, NONE] });

        await svc.spin('u1');
        await svc.spin('u1');

        expect(warn).toHaveBeenCalledTimes(1);
      });

      it('cấu hình hợp lệ: không log, không đổi phân phối (giải đầu vẫn trúng khi random = 0)', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        jest.spyOn(Math, 'random').mockReturnValue(0);
        const prisma = makePrisma();

        const res = (await spinWith(prisma, loyaltyWithExpiry(0).loyalty).spin('u1')) as { prize: { id: string } };

        expect(res.prize.id).toBe('a');
        expect(warn).not.toHaveBeenCalled();
      });
    });

    it('guard atomic count=0 dù pre-check qua (số dư đổi giữa hai câu) → 400, không ghi sổ/lượt quay', async () => {
      const prisma = makePrisma();
      withBalance(prisma, 100);
      (prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      await expect(spinWith(prisma, loyaltyWithExpiry(20).loyalty).spin('u1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
      expect(prisma.gameSpin.create).not.toHaveBeenCalled();
    });

    it('chỉ chạm lô STANDARD: không đọc/trừ pointsConvertedBalance (lô quy đổi không vào vòng quay)', async () => {
      const prisma = makePrisma();
      jest.spyOn(Math, 'random').mockReturnValue(0.9);
      await spinWith(prisma, loyaltyWithExpiry(0).loyalty).spin('u1');
      const sql = ((prisma.$queryRaw as jest.Mock).mock.calls[0][0] as string[]).join('?');
      expect(sql).not.toMatch(/pointsConvertedBalance/);
      expect(JSON.stringify((prisma.user.updateMany as jest.Mock).mock.calls)).not.toMatch(/pointsConvertedBalance/);
    });

    it('dựng GameService không có LoyaltyService thì quay ném lỗi dù giải là NONE (không âm thầm bỏ qua khoá), không mở tx', async () => {
      const prisma = makePrisma();
      withBalance(prisma, 100);
      const svc = new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES }), analytics);
      jest.spyOn(Math, 'random').mockReturnValue(0.9); // giải 'b' (NONE)
      await expect(svc.spin('u1')).rejects.toThrow(/LoyaltyService/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  it('quay trúng giải POINTS → trừ cost ATOMIC + cộng thưởng + ghi lịch sử', async () => {
    const prisma = makePrisma();
    withBalance(prisma, 100);
    jest.spyOn(Math, 'random').mockReturnValue(0.1); // r = 0.1*100 = 10 → giải 'a' (weight 70)
    const svc = new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES }), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);
    const r = await svc.spin('u1');
    expect(r.prize.id).toBe('a');
    // cost trừ atomic qua updateMany (where gte cost), thưởng POINTS qua creditPoints ($transaction)
    expect((prisma.user.updateMany as jest.Mock).mock.calls[0][0].where).toEqual({ id: 'u1', pointsBalance: { gte: 10 } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1); // chỉ thưởng dùng $transaction
    const spinData = (prisma.gameSpin.create as jest.Mock).mock.calls[0][0].data;
    expect(spinData.prizeId).toBe('a');
    (Math.random as jest.Mock).mockRestore();
  });

  // PE-3 (OQ-1): thưởng điểm của vòng quay là Điểm Xanh thường, hết hạn như mọi điểm thưởng khác.
  describe('thưởng POINTS có hạn (PE-3)', () => {
    const spinService = (prisma: PrismaService, loyalty?: LoyaltyService) =>
      new GameService(
        prisma,
        makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES }),
        analytics,
        undefined,
        undefined,
        undefined,
        loyalty,
      );

    afterEach(() => jest.restoreAllMocks());

    it('dòng GAME_SPIN_WIN mang expiresAt do pointsExpiresAt trả; số điểm, reason, refType không đổi; dòng phí quay không có hạn', async () => {
      const prisma = makePrisma();
      withBalance(prisma, 100);
      jest.spyOn(Math, 'random').mockReturnValue(0.1); // giải 'a' (POINTS 5)
      const { loyalty, pointsExpiresAt } = loyaltyWithExpiry();
      await spinService(prisma, loyalty).spin('u1');

      const rows = (prisma.pointsTransaction.create as jest.Mock).mock.calls.map((c) => c[0].data);
      expect(rows).toEqual([
        { userId: 'u1', delta: -10, reason: 'GAME_SPIN_COST', refType: 'GAME' },
        { userId: 'u1', delta: 5, reason: 'GAME_SPIN_WIN:a', refType: 'GAME', expiresAt: REWARD_EXPIRES_AT },
      ]);
      expect(pointsExpiresAt).toHaveBeenCalledTimes(1);
      expect(pointsExpiresAt.mock.calls[0]![0]).toBeInstanceOf(Date);
      expect((prisma.user.update as jest.Mock).mock.calls[0][0]).toEqual({ where: { id: 'u1' }, data: { pointsBalance: { increment: 5 } } });
    });

    it('hạn được tính NGOÀI transaction (trước khi mở tx), không giữ kết nối tx trong lúc đọc cấu hình', async () => {
      const prisma = makePrisma();
      withBalance(prisma, 100);
      jest.spyOn(Math, 'random').mockReturnValue(0.1);
      const { loyalty, pointsExpiresAt } = loyaltyWithExpiry();
      await spinService(prisma, loyalty).spin('u1');
      expect(pointsExpiresAt.mock.invocationCallOrder[0]!).toBeLessThan((prisma.$transaction as jest.Mock).mock.invocationCallOrder[0]!);
    });

    it('trúng giải không phải POINTS → không đọc cấu hình hạn và không ghi dòng thưởng', async () => {
      const prisma = makePrisma();
      withBalance(prisma, 100);
      jest.spyOn(Math, 'random').mockReturnValue(0.9); // giải 'b' (NONE)
      const { loyalty, pointsExpiresAt } = loyaltyWithExpiry();
      await spinService(prisma, loyalty).spin('u1');
      expect(pointsExpiresAt).not.toHaveBeenCalled();
      expect((prisma.pointsTransaction.create as jest.Mock).mock.calls.map((c) => c[0].data.reason)).toEqual(['GAME_SPIN_COST']);
    });

    it('trúng POINTS mà thiếu LoyaltyService → ném lỗi TRƯỚC khi mở tx/trừ điểm (không để lọt điểm không hạn)', async () => {
      const prisma = makePrisma();
      withBalance(prisma, 100);
      jest.spyOn(Math, 'random').mockReturnValue(0.1);
      await expect(spinService(prisma).spin('u1')).rejects.toThrow(/LoyaltyService/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    });
  });

  it('race âm điểm: updateMany count=0 (điểm đã bị trừ) → ném lỗi, không quay', async () => {
    const prisma = makePrisma();
    withBalance(prisma, 100);
    (prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const svc = new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES }), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);
    await expect(svc.spin('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gameSpin.create).not.toHaveBeenCalled();
  });

  // C-043: game.spin_buy_daily_limit từng là khoá chết — vòng quay không có trần lượt/ngày.
  it('đã quay đủ trần lượt/ngày → BadRequest, không ghi lượt quay, không trao thưởng', async () => {
    const prisma = makePrisma();
    withBalance(prisma, 100);
    (prisma.gameSpin.count as jest.Mock).mockResolvedValue(5);
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const svc = new GameService(
      prisma,
      makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES, 'game.spin_buy_daily_limit': 5 }),
      analytics,
      undefined,
      undefined,
      undefined,
      loyaltyWithExpiry().loyalty,
    );
    await expect(svc.spin('u1')).rejects.toThrow('lượt');
    expect(prisma.gameSpin.create).not.toHaveBeenCalled();
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    (Math.random as jest.Mock).mockRestore();
  });

  it('trần lượt/ngày mặc định 5 khi thiếu config; còn dưới trần → quay bình thường', async () => {
    const prisma = makePrisma();
    withBalance(prisma, 100);
    (prisma.gameSpin.count as jest.Mock).mockResolvedValueOnce(4).mockResolvedValueOnce(5);
    const svc = new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES }), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);
    await expect(svc.spin('u1')).resolves.toBeDefined();
    await expect(svc.spin('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gameSpin.create).toHaveBeenCalledTimes(1);
  });

  it('đếm lượt TRONG tx, SAU khi trừ điểm (khoá dòng user) và theo ngày giờ VN', async () => {
    const prisma = makePrisma();
    withBalance(prisma, 100);
    const svc = new GameService(
      prisma,
      makeConfig({ 'game.spin_buy_cost_points': 10, 'game.spin_prizes': PRIZES, 'game.spin_buy_daily_limit': 5 }),
      analytics,
      undefined,
      undefined,
      undefined,
      loyaltyWithExpiry().loyalty,
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
    withBalance(prisma, 100);
    jest.spyOn(Math, 'random').mockReturnValue(0.1); // → giải 'a' (POINTS, weight 70)
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ pointsBalance: 100 }]),
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
      undefined,
      undefined,
      undefined,
      loyaltyWithExpiry().loyalty,
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
      profile({ totalSeeds: 100, ecoImpact: { progress: 100, target: 600, treeType: 't', treesPlanted: 1 } }),
    );
    const r = await new GameService(prisma, makeConfig(), analytics).waterTree('u1', 20);
    expect(r.harvested).toBe(false);
    expect(r.progress).toBe(120);
    expect(r.treesPlanted).toBe(1);
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
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 30, treeType: 't', treesPlanted: 1 } }),
    );
    const r = await new GameService(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3, 'game.tree_target_ladder': [30] }), analytics).waterTree('u1', 70); // 70/30 = 2 cây, dư 10
    expect(r.harvested).toBe(true);
    expect(r.treesPlanted).toBe(3);
    expect(r.progress).toBe(10);
    expect(prisma.coupon.create).toHaveBeenCalledTimes(2);
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(2); // 2 cây thật cam kết
  });

  // C-009 (Q-02): coupon thu hoạch chỉ dùng được cho đơn từ 199.000đ (đọc config), không còn
  // minOrder = giá trị coupon (30k) — chặn biến nước miễn phí thành tiền free trên đơn nhỏ.
  it('coupon thu hoạch: minOrder mặc định 199.000đ (game.harvest_coupon_min_order)', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 590, target: 600, treeType: 't', treesPlanted: 1 } }),
    );
    await new GameService(prisma, makeConfig(), analytics).waterTree('u1', 20);
    const data = (prisma.coupon.create as jest.Mock).mock.calls[0][0].data;
    expect(data.value).toBe(30000);
    expect(data.minOrder).toBe(199000);
  });

  it('coupon thu hoạch: minOrder theo config, nhưng KHÔNG bao giờ thấp hơn giá trị coupon', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 30, treeType: 't', treesPlanted: 1 } }),
    );
    await new GameService(
      prisma,
      makeConfig({ 'game.harvest_coupon_min_order': 250000, 'game.harvest_coupon_amount': 30000 }),
      analytics,
    ).waterTree('u1', 30);
    expect((prisma.coupon.create as jest.Mock).mock.calls[0][0].data.minOrder).toBe(250000);

    const prisma2 = makePrisma();
    (prisma2.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 30, treeType: 't', treesPlanted: 1 } }),
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
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 30, treeType: 't', treesPlanted: 1 } }),
    );
    (prisma.coupon.count as jest.Mock).mockResolvedValue(3); // đã đủ trần mặc định (3/ngày)
    const r = await new GameService(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3, 'game.tree_target_ladder': [30] }), analytics).waterTree('u1', 70); // vẫn đủ 2 lần harvest
    expect(r.harvested).toBe(true);
    expect(r.treesPlanted).toBe(3);
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(2);
    expect(prisma.coupon.create).not.toHaveBeenCalled();
    expect(r.reward.coupon).toBeUndefined();
  });

  it('còn dưới trần → cấp coupon tới khi CHẠM trần trong CÙNG 1 lần tưới, phần sau đó thì thôi', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 30, treeType: 't', treesPlanted: 1 } }),
    );
    (prisma.coupon.count as jest.Mock).mockResolvedValue(2); // còn đúng 1 suất trước khi chạm trần 3
    const r = await new GameService(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3, 'game.tree_target_ladder': [30] }), analytics).waterTree('u1', 70); // 2 lần harvest trong lần gọi này
    expect(r.treesPlanted).toBe(3);
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
          profile({ totalSeeds: 100, ecoImpact: { progress: 100, target: 600, treeType: 't', treesPlanted: 1 } }),
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

describe('GameService.waterTree — không tự đăng bài bảng tin', () => {
  it('thu hoạch dù có feed injected → KHÔNG createAchievementPost; khách tự bấm chia sẻ', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, ecoImpact: { progress: 590, target: 600, treeType: 't', treesPlanted: 1 } }),
    );
    const feed = { createAchievementPost: jest.fn().mockResolvedValue({}) };
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, feed as never);
    const r = await svc.waterTree('u1', 20);
    expect(r.harvested).toBe(true);
    expect(feed.createAchievementPost).not.toHaveBeenCalled();
  });
});

describe('GameService.shareHarvest', () => {
  const build = (o: { user?: unknown; eco?: unknown; existing?: unknown }) => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      feedPost: { findFirst: jest.fn().mockResolvedValue(o.existing ?? null) },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(o.user ?? { zaloId: 'zalo-u1', phone: null }) },
      gameProfile: { findUnique: jest.fn().mockResolvedValue(o.eco === undefined ? null : { ecoImpact: o.eco }) },
      $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const feed = { createAchievementPost: jest.fn().mockResolvedValue({}) };
    return { svc: new GameService(prisma, makeConfig(), analytics, undefined, undefined, feed as never), feed, tx };
  };
  const ecoOf = (treesPlanted: number) => ({ progress: 0, target: 60, treeType: 't', treesPlanted });

  it('guest → 403, không đăng', async () => {
    const { svc, feed } = build({ user: { zaloId: 'guest_x', phone: null }, eco: ecoOf(2) });
    await expect(svc.shareHarvest('u1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(feed.createAchievementPost).not.toHaveBeenCalled();
  });

  it('chưa thu hoạch cây nào → 400', async () => {
    const { svc, feed } = build({ eco: ecoOf(0) });
    await expect(svc.shareHarvest('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(feed.createAchievementPost).not.toHaveBeenCalled();
  });

  it('khách thật đã thu hoạch → đăng một bài HARVEST với số cây của chính mình', async () => {
    const { svc, feed, tx } = build({ eco: ecoOf(3) });
    await expect(svc.shareHarvest('u1')).resolves.toEqual({ shared: true, alreadyShared: false });
    expect(feed.createAchievementPost).toHaveBeenCalledWith('u1', 'HARVEST', expect.any(String), { treesPlanted: 3 }, tx);
  });

  it('mức cây này đã có bài → không đăng thêm', async () => {
    const { svc, feed } = build({ eco: ecoOf(3), existing: { id: 'p1' } });
    await expect(svc.shareHarvest('u1')).resolves.toEqual({ shared: true, alreadyShared: true });
    expect(feed.createAchievementPost).not.toHaveBeenCalled();
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
  it('8 ngày không tưới → vẫn WILTED, không bao giờ DEAD', async () => {
    expect(await health({ lastWateredAt: new Date(Date.now() - 8 * DAYMS), ecoImpact: { progress: 100, target: 600 } })).toBe('WILTED');
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

describe('GameService.waterTree — cây bỏ lâu chỉ héo, không mất tiến độ', () => {
  it('tưới cây quá death_days → GIỮ tiến độ (chỉ héo), +drops, revivedFromDead luôn false', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, lastWateredAt: new Date(Date.now() - 8 * 86400000), ecoImpact: { progress: 500, target: 600, treeType: 't', treesPlanted: 1 } }),
    );
    const r = (await new GameService(prisma, makeConfig(), analytics).waterTree('u1', 20)) as { progress: number; revivedFromDead: boolean; harvested: boolean };
    expect(r.revivedFromDead).toBe(false);
    expect(r.progress).toBe(520); // 500 giữ nguyên, +20
    expect(r.harvested).toBe(false);
  });

  it('tưới cây còn sống → giữ tiến trình', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 100, lastWateredAt: new Date(Date.now() - 1 * 86400000), ecoImpact: { progress: 500, target: 600, treeType: 't', treesPlanted: 1 } }),
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
      lockedOrderPoints: jest.fn(async (..._args: unknown[]) => ({ locked, lockedReturn: 0, lockedUntil: null })),
      lockedPointsMessage: () => 'điểm từ đơn mới giao dùng được sau hạn đổi/trả',
      returnWindowDays: jest.fn(async () => WINDOW_DAYS),
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

  it('PD-3: góp quỹ = game.tree_points_price (mặc định 50.000) Điểm Xanh, đủ lô STANDARD → chỉ trừ STANDARD', async () => {
    const { prisma, state, entries } = buyPrisma({ pointsBalance: 80_000, pointsConvertedBalance: 100_000 });
    const svc = buyService(prisma);
    const r = await svc.buyTree('u1');
    expect(r).toMatchObject({ cost: 50_000, pointsUsed: 50_000, pointsUsedConverted: 0 });
    expect(r.certificateCode).toMatch(/^TUBU-/);
    expect(state).toEqual({ pointsBalance: 30_000, pointsConvertedBalance: 100_000 });
    expect(entries).toEqual([
      expect.objectContaining({ delta: -50_000, lot: 'STANDARD', reason: `GAME_BUY_TREE:${r.certificateCode}`, refType: 'GAME' }),
    ]);
    expect((prisma.plantedTree.create as jest.Mock).mock.calls[0][0].data.certificateCode).toBe(r.certificateCode);
  });

  it('PD-3 (OQ-5): STANDARD thiếu → tiêu hết STANDARD rồi phần còn lại từ lô quy đổi, 2 dòng sổ đúng lô', async () => {
    const { prisma, state, entries } = buyPrisma({ pointsBalance: 20_000, pointsConvertedBalance: 100_000 });
    const svc = buyService(prisma, makeConfig({ 'game.tree_points_price': 50_000 }));
    const r = await svc.buyTree('u1');
    expect(r).toMatchObject({ cost: 50_000, pointsUsed: 50_000, pointsUsedConverted: 30_000 });
    expect(state).toEqual({ pointsBalance: 0, pointsConvertedBalance: 70_000 });
    expect(entries.map((e) => [e.lot, e.delta])).toEqual([
      ['STANDARD', -20_000],
      ['CONVERTED', -30_000],
    ]);
  });

  it('PD-3: tổng hai lô không đủ → 400, không trừ gì, không tạo PlantedTree', async () => {
    const { prisma, state, entries } = buyPrisma({ pointsBalance: 20_000, pointsConvertedBalance: 29_000 });
    const svc = buyService(prisma);
    await expect(svc.buyTree('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(state).toEqual({ pointsBalance: 20_000, pointsConvertedBalance: 29_000 });
    expect(entries).toHaveLength(0);
    expect(prisma.plantedTree.create).not.toHaveBeenCalled();
  });

  it('PD-3: khoá dòng user (FOR UPDATE) trước khi chia lô', async () => {
    const { prisma } = buyPrisma({ pointsBalance: 80_000, pointsConvertedBalance: 0 });
    await buyService(prisma).buyTree('u1');
    const raw = (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw;
    expect((raw.mock.calls[0][0] as string[]).join('?')).toMatch(/FROM "users"[\s\S]*FOR UPDATE/);
  });

  it('review C1: điểm thường đang khoá không bị tiêu, phần còn lại lấy từ lô quy đổi (đọc khoá SAU khi khoá dòng user)', async () => {
    const { prisma, state, entries } = buyPrisma({ pointsBalance: 80_000, pointsConvertedBalance: 100_000 });
    const loyalty = loyaltyWithLock(60_000);
    const r = await buyService(prisma, makeConfig(), loyalty).buyTree('u1');
    // 80 − 60 khoá = 20 dùng được → thường 20, quy đổi 30.
    expect(r).toMatchObject({ pointsUsed: 50_000, pointsUsedConverted: 30_000 });
    expect(state).toEqual({ pointsBalance: 60_000, pointsConvertedBalance: 70_000 });
    expect(entries.map((e) => [e.lot, e.delta])).toEqual([
      ['STANDARD', -20_000],
      ['CONVERTED', -30_000],
    ]);
    expect((loyalty.lockedOrderPoints as jest.Mock).mock.calls[0][0]).toBe('u1');
  });

  it('review C1: toàn bộ điểm thường đang khoá và không có điểm quy đổi → 400 kèm lý do khoá, không trừ gì', async () => {
    const { prisma, state, entries } = buyPrisma({ pointsBalance: 60_000, pointsConvertedBalance: 0 });
    const err = await buyService(prisma, makeConfig(), loyaltyWithLock(60_000))
      .buyTree('u1')
      .then(() => new Error('không ném lỗi'), (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/Cần 50\.000 Điểm Xanh/);
    expect(err.message).toMatch(/chưa dùng được/);
    expect(state).toEqual({ pointsBalance: 60_000, pointsConvertedBalance: 0 });
    expect(entries).toHaveLength(0);
    expect(prisma.plantedTree.create).not.toHaveBeenCalled();
  });

  it('PF-6a (b): góp quỹ đọc cửa sổ đổi/trả NGOÀI tx (trước $transaction), truyền vào lockedOrderPoints; không có lần đọc cấu hình nào trong tx', async () => {
    const { prisma } = buyPrisma({ pointsBalance: 80_000, pointsConvertedBalance: 0 });
    const loyalty = loyaltyWithLock(0);
    const { config, configGets } = trackTx(prisma);

    await buyService(prisma, config, loyalty).buyTree('u1');

    const returnWindowDays = loyalty.returnWindowDays as jest.Mock;
    expect(returnWindowDays).toHaveBeenCalledTimes(1);
    expect(returnWindowDays.mock.invocationCallOrder[0]).toBeLessThan((prisma.$transaction as jest.Mock).mock.invocationCallOrder[0]!);
    expect((loyalty.lockedOrderPoints as jest.Mock).mock.calls[0]![3]).toBe(WINDOW_DAYS);
    expect(configGets.filter((g) => g.inTx)).toEqual([]);
  });

  it('PF-6a (b): góp quỹ phát lại theo Idempotency-Key (không đi tới lockedOrderPoints) vẫn không đọc cấu hình trong tx', async () => {
    const { prisma } = buyPrisma({ pointsBalance: 200_000, pointsConvertedBalance: 0 });
    const loyalty = loyaltyWithLock(0);
    const { config, configGets } = trackTx(prisma);
    const svc = buyService(prisma, config, loyalty);
    const key = '11111111-2222-4333-8444-555555555555';

    const first = await svc.buyTree('u1', key);
    const replay = await svc.buyTree('u1', key);

    expect(replay.certificateCode).toBe(first.certificateCode);
    expect(configGets.filter((g) => g.inTx)).toEqual([]);
  });

  it('review C1: dựng GameService không có LoyaltyService thì góp quỹ ném lỗi (không âm thầm bỏ qua khoá), không trừ gì', async () => {
    const { prisma, state } = buyPrisma({ pointsBalance: 80_000, pointsConvertedBalance: 0 });
    await expect(new GameService(prisma, makeConfig(), analytics).buyTree('u1')).rejects.toThrow(/LoyaltyService/);
    expect(state).toEqual({ pointsBalance: 80_000, pointsConvertedBalance: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  /**
   * OQ-5: bấm đôi nút góp quỹ không được thành hai lượt. Có Idempotency-Key thì mã chứng nhận suy ra tất định
   * từ (user, key) và lần gọi lại trả đúng kết quả lượt đầu; race thật ở test/integration-race/game-tree-idempotency.
   */
  describe('Idempotency-Key', () => {
    const KEY = 'tree-buy-key-0001';

    it('có key: mã chứng nhận suy ra tất định từ (user, key), dòng sổ mang đúng mã đó', async () => {
      const { prisma, entries } = buyPrisma({ pointsBalance: 80_000, pointsConvertedBalance: 0 });
      const r = await buyService(prisma).buyTree('u1', KEY);
      expect(r.certificateCode).toBe(treeCertificateCodeFor('u1', KEY));
      expect(entries).toEqual([expect.objectContaining({ reason: `GAME_BUY_TREE:${r.certificateCode}`, userId: 'u1' })]);
    });

    it('gọi lại cùng (user, key): trả ĐÚNG kết quả lượt đầu, KHÔNG trừ thêm, KHÔNG tạo cây thứ hai', async () => {
      const { prisma, state, entries, trees } = buyPrisma({ pointsBalance: 80_000, pointsConvertedBalance: 0 });
      const svc = buyService(prisma);
      const first = await svc.buyTree('u1', KEY);
      const second = await svc.buyTree('u1', KEY);
      expect(second).toEqual(first);
      expect(state).toEqual({ pointsBalance: 30_000, pointsConvertedBalance: 0 });
      expect(entries).toHaveLength(1);
      expect(trees).toHaveLength(1);
      expect(prisma.plantedTree.create).toHaveBeenCalledTimes(1);
    });

    it('replay trả đúng phần quy đổi và giá của lượt đầu dù giá cấu hình đã đổi sau đó', async () => {
      const { prisma, state } = buyPrisma({ pointsBalance: 20_000, pointsConvertedBalance: 100_000 });
      const first = await buyService(prisma, makeConfig({ 'game.tree_points_price': 50_000 })).buyTree('u1', KEY);
      expect(first).toMatchObject({ cost: 50_000, pointsUsed: 50_000, pointsUsedConverted: 30_000 });
      const replay = await buyService(prisma, makeConfig({ 'game.tree_points_price': 80_000 })).buyTree('u1', KEY);
      expect(replay).toEqual(first);
      expect(state).toEqual({ pointsBalance: 0, pointsConvertedBalance: 70_000 });
    });

    it('khoá dòng user (FOR UPDATE) TRƯỚC khi kiểm tra key đã dùng: hai request song song không cùng thấy "chưa có"', async () => {
      const { prisma } = buyPrisma({ pointsBalance: 80_000, pointsConvertedBalance: 0 });
      await buyService(prisma).buyTree('u1', KEY);
      const raw = (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw;
      const lookup = prisma.plantedTree.findUnique as jest.Mock;
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(raw.mock.invocationCallOrder[0]).toBeLessThan(lookup.mock.invocationCallOrder[0]!);
    });

    it('key khác nhau → hai lượt góp riêng với hai mã khác nhau', async () => {
      const { prisma, state } = buyPrisma({ pointsBalance: 200_000, pointsConvertedBalance: 0 });
      const svc = buyService(prisma);
      const a = await svc.buyTree('u1', KEY);
      const b = await svc.buyTree('u1', 'tree-buy-key-0002');
      expect(a.certificateCode).not.toBe(b.certificateCode);
      expect(state.pointsBalance).toBe(100_000);
    });

    it('thiếu điểm với key → 400, không để lại cây hay dòng sổ; nạp thêm rồi dùng lại CÙNG key thì góp được', async () => {
      const { prisma, state, entries, trees } = buyPrisma({ pointsBalance: 20_000, pointsConvertedBalance: 0 });
      const svc = buyService(prisma);
      await expect(svc.buyTree('u1', KEY)).rejects.toBeInstanceOf(BadRequestException);
      expect(entries).toHaveLength(0);
      expect(trees).toHaveLength(0);
      state.pointsBalance = 80_000;
      const r = await svc.buyTree('u1', KEY);
      expect(r.pointsUsed).toBe(50_000);
      expect(trees).toHaveLength(1);
    });

    it('mã suy ra từ key đã là của người dùng khác (va chạm/cố ý mài key) → 400, không trừ điểm, không lộ dữ liệu của họ', async () => {
      const { prisma, state, entries, trees } = buyPrisma({ pointsBalance: 80_000, pointsConvertedBalance: 0 });
      trees.push({ userId: 'someone-else', certificateCode: treeCertificateCodeFor('u1', KEY), treeType: 'Cây khác' });
      const err = await buyService(prisma)
        .buyTree('u1', KEY)
        .then(() => new Error('không ném lỗi'), (e: unknown) => e as Error);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).not.toMatch(/someone-else|Cây khác/);
      expect(state.pointsBalance).toBe(80_000);
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
      const { prisma, state } = buyPrisma({ pointsBalance: 80_000, pointsConvertedBalance: 0 });
      const err = await buyService(prisma)
        .buyTree('u1', bad)
        .then(() => new Error('không ném lỗi'), (e: unknown) => e as Error);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Idempotency-Key/);
      expect(err.message).toMatch(/8.+128/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(state.pointsBalance).toBe(80_000);
    });

    it('key đúng ở hai biên 8 và 128 ký tự được nhận', async () => {
      const { prisma } = buyPrisma({ pointsBalance: 200_000, pointsConvertedBalance: 0 });
      const svc = buyService(prisma);
      await expect(svc.buyTree('u1', 'a-_Z0129')).resolves.toMatchObject({ cost: 50_000 });
      await expect(svc.buyTree('u1', 'k'.repeat(128))).resolves.toMatchObject({ cost: 50_000 });
    });

    it('không key: như cũ, mã ngẫu nhiên mỗi lần, không tra bản ghi cũ', async () => {
      const { prisma, state } = buyPrisma({ pointsBalance: 200_000, pointsConvertedBalance: 0 });
      const svc = buyService(prisma);
      const a = await svc.buyTree('u1');
      const b = await svc.buyTree('u1');
      expect(a.certificateCode).not.toBe(b.certificateCode);
      expect(a.certificateCode).toMatch(/^TUBU-[0-9A-F]{8}$/);
      expect(state.pointsBalance).toBe(100_000);
      expect(prisma.plantedTree.findUnique).not.toHaveBeenCalled();
    });
  });

  it('getProfile trả spinCostPoints theo game.spin_buy_cost_points (mặc định 10.000)', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile());
    const custom = (await new GameService(prisma, makeConfig({ 'game.spin_buy_cost_points': 20_000 }), analytics).getProfile('u1')) as Record<string, unknown>;
    expect(custom.spinCostPoints).toBe(20_000);
    const def = (await new GameService(prisma, makeConfig(), analytics).getProfile('u1')) as Record<string, unknown>;
    expect(def.spinCostPoints).toBe(10_000);
  });

  it('PD-3: getProfile trả treePointsPrice, bỏ xuPerSeed/treeXuPrice', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile());
    const r = (await new GameService(prisma, makeConfig({ 'game.tree_points_price': 50_000 }), analytics).getProfile('u1')) as Record<string, unknown>;
    expect(r.treePointsPrice).toBe(50_000);
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
      review: { findMany: jest.fn().mockResolvedValue(reviewedProducts(2)) },
      order: settledOrders(2),
      user: { count: jest.fn().mockResolvedValue(0) },
      mission: { findMany: jest.fn().mockResolvedValue(MISSIONS) },
      missionProgress: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const svc = new GameService(prisma, makeConfig(), analytics);
    const res = await svc.getMissions('u1');
    expect(res).toEqual([
      { code: 'CHECKIN_7', kind: 'CHECKIN_STREAK', title: 'Chăm chỉ 7 ngày', description: undefined, rewardPoints: 30, progress: 3, goal: 7, completed: false, claimed: false },
      { code: 'FIRST_ORDER', kind: 'ORDER_COUNT', title: 'Đơn hàng đầu tiên', description: undefined, rewardPoints: 20, progress: 1, goal: 1, completed: true, claimed: false },
      { code: 'REVIEW_3', kind: 'REVIEW_COUNT', title: 'Nhà phê bình', description: undefined, rewardPoints: 15, progress: 2, goal: 3, completed: false, claimed: false },
      { code: 'INVITE_3', kind: 'INVITE_COUNT', title: 'Lan tỏa sống xanh', description: undefined, rewardPoints: 50, progress: 0, goal: 3, completed: false, claimed: false },
    ]);
  });

  // R2-ENGAGE-7: mô tả nhiệm vụ REVIEW_3 là "Viết 3 đánh giá có ảnh" nên chỉ đánh giá có ít nhất 1 ảnh được tính. Mỗi lần
  // mua được một đánh giá nên đếm theo sản phẩm khác nhau: mua cùng một sản phẩm ba lần không xong nhiệm vụ.
  it('REVIEW_3 đếm số SẢN PHẨM khác nhau khách đã đánh giá có ảnh (gom theo productId), không đếm dòng đánh giá', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { productId: 'p1', orderId: 'o1' },
      { productId: 'p1', orderId: 'o2' },
      { productId: 'p1', orderId: 'o3' },
    ]);
    const prisma = makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 0 }) },
      order: settledOrders(3),
      review: { findMany },
      user: { count: jest.fn().mockResolvedValue(0) },
      mission: { findMany: jest.fn().mockResolvedValue(MISSIONS) },
      missionProgress: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const res = await new GameService(prisma, makeConfig(), analytics).getMissions('u1');
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', NOT: { images: { isEmpty: true } } },
      select: { productId: true, orderId: true, createdAt: true },
    });
    expect(res.find((m) => m.code === 'REVIEW_3')).toMatchObject({ progress: 1, goal: 3, completed: false, claimed: false });
  });

  it('REVIEW_3 đủ 3 sản phẩm khác nhau → xong, chưa nhận thì nhận được', async () => {
    const prisma = makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 0 }) },
      review: { findMany: jest.fn().mockResolvedValue(reviewedProducts(3)) },
      order: settledOrders(3),
      mission: { findMany: jest.fn().mockResolvedValue(MISSIONS) },
    });
    const res = await new GameService(prisma, makeConfig(), analytics).getMissions('u1');
    expect(res.find((m) => m.code === 'REVIEW_3')).toMatchObject({ progress: 3, goal: 3, completed: true, claimed: false });
  });

  it('nhiệm vụ không lặp lại đã nhận mà chỉ số nay tụt dưới goal (REVIEW_3 nhận theo cách đếm dòng cũ) → vẫn xong, đủ tiến độ, đã nhận', async () => {
    const prisma = makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 0 }) },
      review: { findMany: jest.fn().mockResolvedValue(reviewedProducts(1)) },
      order: settledOrders(1),
      mission: { findMany: jest.fn().mockResolvedValue(MISSIONS) },
      missionProgress: { findMany: jest.fn().mockResolvedValue([{ missionId: 'm3', cycleKey: '0', progress: 3, goal: 3 }]) },
    });
    const res = await new GameService(prisma, makeConfig(), analytics).getMissions('u1');
    expect(res.find((m) => m.code === 'REVIEW_3')).toMatchObject({ progress: 3, goal: 3, completed: true, claimed: true });
    // Nhiệm vụ chưa nhận vẫn theo chỉ số thô.
    expect(res.find((m) => m.code === 'FIRST_ORDER')).toMatchObject({ progress: 1, completed: true, claimed: false });
  });

  it('A1-02: nhiệm vụ đã có dòng mission_progress khớp (missionId, cycleKey hiện tại) → claimed=true', async () => {
    const prisma = makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 0 }) },
      order: settledOrders(1), // FIRST_ORDER: raw=1, goal=1 → cycleKey '0' (không lặp lại)
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
      order: settledOrders(0),
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

  it('ENGAGE-1: INVITE_3 đếm lượt giới thiệu THÀNH CÔNG (sổ thưởng REFERRAL_ORDER2 trừ thu hồi), không đếm tài khoản được mời', async () => {
    const pointsCount = jest.fn().mockImplementation(async ({ where }: { where: { reason: { startsWith: string } } }) => (where.reason.startsWith === 'REFERRAL_ORDER2:' ? 2 : 0));
    const pointsFind = jest.fn();
    const userCount = jest.fn().mockResolvedValue(3);
    const prisma = makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 0 }) },
      user: { count: userCount },
      pointsTransaction: { count: pointsCount, findMany: pointsFind },
      mission: { findMany: jest.fn().mockResolvedValue(MISSIONS) },
    });
    const res = await new GameService(prisma, makeConfig(), analytics).getMissions('u1');
    const invite = res.find((m) => m.code === 'INVITE_3')!;
    expect(invite.progress).toBe(2);
    expect(invite.completed).toBe(false);
    expect(userCount).not.toHaveBeenCalled();
    expect(pointsFind).not.toHaveBeenCalled();
  });

  it('ENGAGE-1: FIRST_ORDER chỉ đếm đơn bán lẻ ĐÃ GIAO của chính khách (không tính đơn đang xử lý / đặt hộ)', async () => {
    const orderFindMany = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 0 }) },
      order: { findMany: orderFindMany },
      mission: { findMany: jest.fn().mockResolvedValue(MISSIONS) },
    });
    await new GameService(prisma, makeConfig(), analytics).getMissions('u1');
    expect(orderFindMany).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false },
      select: { id: true, deliveredAt: true, updatedAt: true },
    });
  });

  it('nhiệm vụ do quản trị thêm được chấm theo loại; nhiệm vụ đang tạm dừng bị lọc khỏi truy vấn', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'm9', code: 'CUSTOM_AB12CD34', kind: 'REVIEW_COUNT', title: 'Chấm điểm sản phẩm', goal: 5, rewardPoints: 40, isRepeatable: false },
    ]);
    const prisma = makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 0 }) },
      review: { findMany: jest.fn().mockResolvedValue(reviewedProducts(2)) },
      order: settledOrders(2),
      user: { count: jest.fn().mockResolvedValue(0) },
      mission: { findMany },
      missionProgress: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const [custom] = await new GameService(prisma, makeConfig(), analytics).getMissions('u1');
    expect(custom).toMatchObject({ code: 'CUSTOM_AB12CD34', progress: 2, goal: 5, completed: false, claimed: false });
    expect(findMany).toHaveBeenCalledWith({ where: { disabledAt: null } });
  });

  it('ENGAGE-11: nhiệm vụ không lặp lại đã có dòng nhận ở chu kỳ bất kỳ (dữ liệu cũ khi còn lặp lại) → claimed=true', async () => {
    const prisma = makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 21 }) },
      mission: { findMany: jest.fn().mockResolvedValue([{ ...MISSIONS[0], isRepeatable: false }]) },
      missionProgress: { findMany: jest.fn().mockResolvedValue([{ missionId: 'm1', cycleKey: '1' }]) },
    });
    const [checkin] = await new GameService(prisma, makeConfig(), analytics).getMissions('u1');
    expect(checkin!.completed).toBe(true);
    expect(checkin!.claimed).toBe(true);
  });
});

describe('GameService — nhiệm vụ FIRST_ORDER, REVIEW_3 chỉ tính đơn đã qua hạn đổi/trả', () => {
  const FIRST = { id: 'm2', code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', goal: 1, rewardPoints: 20, isRepeatable: false, rewardCoupon: null };
  const REVIEW3 = { id: 'm3', code: 'REVIEW_3', title: 'Nhà phê bình', goal: 3, rewardPoints: 15, isRepeatable: false, rewardCoupon: null };

  /** order.count trả 1 như bản đếm cũ (mọi đơn DELIVERED); order.findMany trả đúng các đơn của test. */
  function prismaWith(over: Record<string, unknown>) {
    return makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 0 }) },
      ...over,
    });
  }
  const service = (prisma: PrismaService, overrides: Record<string, unknown> = {}) =>
    new GameService(prisma, makeConfig(overrides), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);

  it('FIRST_ORDER: đơn giao 1 ngày trước, returns.window_days = 7 → không nhận được, không ghi claim, không cộng điểm', async () => {
    const missionProgressCreate = jest.fn();
    const pointsCreate = jest.fn();
    const prisma = prismaWith({
      mission: { findUnique: jest.fn().mockResolvedValue(FIRST) },
      order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 1)]) },
      missionProgress: { create: missionProgressCreate },
      pointsTransaction: { create: pointsCreate },
    });
    await expect(service(prisma, { 'returns.window_days': 7 }).claimMission('u1', 'FIRST_ORDER')).rejects.toThrow(
      'Chưa đủ điều kiện để nhận thưởng nhiệm vụ này.',
    );
    expect(missionProgressCreate).not.toHaveBeenCalled();
    expect(pointsCreate).not.toHaveBeenCalled();
  });

  it('FIRST_ORDER: đơn giao 8 ngày trước (qua hạn 7 ngày), không có yêu cầu trả → nhận được', async () => {
    const prisma = prismaWith({
      mission: { findUnique: jest.fn().mockResolvedValue(FIRST) },
      order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 8)]) },
      missionProgress: { create: jest.fn().mockResolvedValue({ id: 'mp1' }) },
      pointsTransaction: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
    });
    await expect(service(prisma, { 'returns.window_days': 7 }).claimMission('u1', 'FIRST_ORDER')).resolves.toMatchObject({ claimed: true });
  });

  it('FIRST_ORDER: đơn đã qua hạn nhưng đang có yêu cầu trả chờ duyệt → chưa nhận được', async () => {
    const prisma = prismaWith({
      mission: { findUnique: jest.fn().mockResolvedValue(FIRST) },
      order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 30)]) },
      returnRequest: { findMany: jest.fn().mockResolvedValue([{ orderId: 'o1' }]) },
    });
    await expect(service(prisma).claimMission('u1', 'FIRST_ORDER')).rejects.toThrow('Chưa đủ điều kiện để nhận thưởng nhiệm vụ này.');
  });

  it('cửa sổ đổi/trả đọc từ returns.window_days: đặt 0 ngày thì đơn giao 1 ngày trước đã tính', async () => {
    const prisma = prismaWith({
      mission: { findUnique: jest.fn().mockResolvedValue(FIRST) },
      order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 1)]) },
      missionProgress: { create: jest.fn().mockResolvedValue({ id: 'mp1' }) },
      pointsTransaction: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
    });
    await expect(service(prisma, { 'returns.window_days': 0 }).claimMission('u1', 'FIRST_ORDER')).resolves.toMatchObject({ claimed: true });
  });

  it('REVIEW_3: đánh giá có ảnh của đơn còn trong hạn đổi/trả không được tính', async () => {
    const prisma = prismaWith({
      mission: { findUnique: jest.fn().mockResolvedValue(REVIEW3) },
      order: {
        findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 30), deliveredOrder('o2', 30), deliveredOrder('o3', 2)]),
      },
      review: {
        findMany: jest.fn().mockResolvedValue(reviewedProducts(3)),
      },
    });
    await expect(service(prisma, { 'returns.window_days': 7 }).claimMission('u1', 'REVIEW_3')).rejects.toThrow(
      'Chưa đủ điều kiện để nhận thưởng nhiệm vụ này.',
    );
  });

  it('getMissions: đã có đơn nhưng còn trong hạn đổi/trả → tiến độ 0 và thẻ nói đang chờ hết hạn đổi/trả', async () => {
    const prisma = prismaWith({
      mission: { findMany: jest.fn().mockResolvedValue([FIRST]) },
      order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 1)]) },
    });
    const [first] = await service(prisma, { 'returns.window_days': 7 }).getMissions('u1');
    expect(first).toMatchObject({ code: 'FIRST_ORDER', progress: 0, completed: false, claimed: false });
    expect(first!.description).toMatch(/đổi\/trả/);
  });

  it('getMissions: đơn đã qua hạn đổi/trả nhưng còn yêu cầu trả chờ duyệt → thẻ không hứa "mở khi hết hạn", nói chờ yêu cầu trả được xử lý', async () => {
    const prisma = prismaWith({
      mission: { findMany: jest.fn().mockResolvedValue([FIRST]) },
      order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 30)]) },
      returnRequest: { findMany: jest.fn().mockResolvedValue([{ orderId: 'o1' }]) },
    });
    const [first] = await service(prisma, { 'returns.window_days': 7 }).getMissions('u1');
    expect(first).toMatchObject({ code: 'FIRST_ORDER', progress: 0, completed: false });
    expect(first!.description).toMatch(/yêu cầu trả[^.]*đã được xử lý/);
  });

  /** Dòng trả đã duyệt của sản phẩm `productId` trên đơn `orderId` (qua dòng hàng i-<orderId> và biến thể v-<productId>). */
  const approvedReturn = (orderId: string, productId: string) => ({
    returnRequestItem: { findMany: jest.fn().mockResolvedValue([{ orderItemId: `i-${orderId}` }]) },
    orderItem: { findMany: jest.fn().mockResolvedValue([{ orderId, variationId: `v-${productId}` }]) },
    variation: { findMany: jest.fn().mockResolvedValue([{ id: `v-${productId}`, productId }]) },
  });

  it('REVIEW_3: đánh giá của sản phẩm đã bị trả một phần (thưởng đã thu hồi) không được tính dù đơn đã qua hạn', async () => {
    const prisma = prismaWith({
      mission: { findUnique: jest.fn().mockResolvedValue(REVIEW3) },
      order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 30), deliveredOrder('o2', 30), deliveredOrder('o3', 30)]) },
      review: { findMany: jest.fn().mockResolvedValue(reviewedProducts(3)) },
      ...approvedReturn('o2', 'p2'),
    });
    await expect(service(prisma, { 'returns.window_days': 7 }).claimMission('u1', 'REVIEW_3')).rejects.toThrow(
      'Chưa đủ điều kiện để nhận thưởng nhiệm vụ này.',
    );
  });

  it('REVIEW_3: dòng trả được duyệt là của sản phẩm khác sản phẩm đã đánh giá → vẫn tính đủ ba', async () => {
    const prisma = prismaWith({
      mission: { findUnique: jest.fn().mockResolvedValue(REVIEW3) },
      order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 30), deliveredOrder('o2', 30), deliveredOrder('o3', 30)]) },
      review: { findMany: jest.fn().mockResolvedValue(reviewedProducts(3)) },
      missionProgress: { create: jest.fn().mockResolvedValue({ id: 'mp1' }) },
      pointsTransaction: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
      ...approvedReturn('o2', 'p99'),
    });
    await expect(service(prisma, { 'returns.window_days': 7 }).claimMission('u1', 'REVIEW_3')).resolves.toMatchObject({ claimed: true });
  });

  it('getMissions REVIEW_3: 1 đánh giá đã tính + 1 còn chờ hạn (tổng 2 < 3) → không ghi chú chờ vì khách còn phải viết thêm', async () => {
    const prisma = prismaWith({
      mission: { findMany: jest.fn().mockResolvedValue([{ ...REVIEW3, description: 'Viết 3 đánh giá có ảnh' }]) },
      order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 30), deliveredOrder('o2', 1)]) },
      review: { findMany: jest.fn().mockResolvedValue(reviewedProducts(2)) },
    });
    const [m] = await service(prisma, { 'returns.window_days': 7 }).getMissions('u1');
    expect(m).toMatchObject({ code: 'REVIEW_3', progress: 1, description: 'Viết 3 đánh giá có ảnh' });
  });

  it('getMissions REVIEW_3: 1 đã tính + 2 còn chờ hạn (tổng đủ 3) → có ghi chú chờ hết hạn đổi/trả', async () => {
    const prisma = prismaWith({
      mission: { findMany: jest.fn().mockResolvedValue([{ ...REVIEW3, description: 'Viết 3 đánh giá có ảnh' }]) },
      order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 30), deliveredOrder('o2', 1), deliveredOrder('o3', 1)]) },
      review: { findMany: jest.fn().mockResolvedValue(reviewedProducts(3)) },
    });
    const [m] = await service(prisma, { 'returns.window_days': 7 }).getMissions('u1');
    expect(m).toMatchObject({ code: 'REVIEW_3', progress: 1 });
    expect(m!.description).toMatch(/^Viết 3 đánh giá có ảnh .*đổi\/trả/);
  });

  it('getMissions REVIEW_3: đánh giá của sản phẩm đã bị trả không tính vào cả phần đã tính lẫn phần chờ', async () => {
    const prisma = prismaWith({
      mission: { findMany: jest.fn().mockResolvedValue([{ ...REVIEW3, description: 'Viết 3 đánh giá có ảnh' }]) },
      order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 30), deliveredOrder('o2', 1), deliveredOrder('o3', 1)]) },
      review: { findMany: jest.fn().mockResolvedValue(reviewedProducts(3)) },
      ...approvedReturn('o2', 'p2'),
    });
    const [m] = await service(prisma, { 'returns.window_days': 7 }).getMissions('u1');
    expect(m).toMatchObject({ progress: 1, description: 'Viết 3 đánh giá có ảnh' });
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
      order: settledOrders(1),
      ...over,
    });
  }

  it('nhiệm vụ không tồn tại → NotFoundException', async () => {
    const prisma = missionsPrisma({ mission: { findUnique: jest.fn().mockResolvedValue(null) } });
    const svc = new GameService(prisma, makeConfig(), analytics);
    await expect(svc.claimMission('u1', 'NOPE')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('nhiệm vụ đang tạm dừng → BadRequest, không ghi gì, không cộng điểm', async () => {
    const missionProgressCreate = jest.fn();
    const prisma = missionsPrisma({
      mission: {
        findUnique: jest.fn().mockResolvedValue({ id: 'm2', code: 'FIRST_ORDER', goal: 1, rewardPoints: 20, isRepeatable: false, rewardCoupon: null, disabledAt: new Date() }),
      },
      missionProgress: { create: missionProgressCreate },
    });
    await expect(new GameService(prisma, makeConfig(), analytics).claimMission('u1', 'FIRST_ORDER')).rejects.toThrow('tạm dừng');
    expect(missionProgressCreate).not.toHaveBeenCalled();
  });

  it('chưa đủ điều kiện (raw < goal) → BadRequest, KHÔNG insert mission_progress, KHÔNG cộng điểm', async () => {
    const missionProgressCreate = jest.fn();
    const pointsCreate = jest.fn();
    const prisma = missionsPrisma({
      order: settledOrders(0), // FIRST_ORDER goal=1, raw=0 → chưa đạt
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
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);
    const res = await svc.claimMission('u1', 'FIRST_ORDER');

    expect(res).toEqual({ claimed: true, rewardPoints: 20, couponCode: null });
    expect(missionProgressCreate).toHaveBeenCalledWith({
      data: { userId: 'u1', missionId: 'm2', cycleKey: '0', progress: 1, goal: 1, completedAt: expect.any(Date) },
    });
    expect(pointsCreate).toHaveBeenCalledTimes(1);
    expect(pointsCreate).toHaveBeenCalledWith({
      data: { userId: 'u1', delta: 20, reason: 'MISSION:FIRST_ORDER:0', refType: 'GAME', expiresAt: REWARD_EXPIRES_AT },
    });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsBalance: { increment: 20 } } });
  });

  // PE-3 (OQ-1): thưởng nhiệm vụ là Điểm Xanh thường, hết hạn theo loyalty.point_expire_months.
  describe('thưởng nhiệm vụ có hạn (PE-3)', () => {
    const missionService = (prisma: PrismaService, loyalty?: LoyaltyService) =>
      new GameService(prisma, makeConfig(), analytics, undefined, undefined, undefined, loyalty);

    it('dòng MISSION:<mã>:<chu kỳ> mang expiresAt do pointsExpiresAt trả; số điểm, reason, refType không đổi', async () => {
      const pointsCreate = jest.fn().mockResolvedValue({});
      const prisma = missionsPrisma({
        missionProgress: { create: jest.fn().mockResolvedValue({ id: 'mp1' }) },
        pointsTransaction: { create: pointsCreate },
        user: { count: jest.fn().mockResolvedValue(0), update: jest.fn().mockResolvedValue({}) },
      });
      const { loyalty, pointsExpiresAt } = loyaltyWithExpiry();
      const res = await missionService(prisma, loyalty).claimMission('u1', 'FIRST_ORDER');
      expect(res).toEqual({ claimed: true, rewardPoints: 20, couponCode: null });
      expect(pointsCreate).toHaveBeenCalledTimes(1);
      expect(pointsCreate).toHaveBeenCalledWith({
        data: { userId: 'u1', delta: 20, reason: 'MISSION:FIRST_ORDER:0', refType: 'GAME', expiresAt: REWARD_EXPIRES_AT },
      });
      expect(pointsExpiresAt).toHaveBeenCalledTimes(1);
    });

    it('hạn được tính NGOÀI transaction, trước khi mở tx', async () => {
      const prisma = missionsPrisma({
        missionProgress: { create: jest.fn().mockResolvedValue({ id: 'mp1' }) },
        pointsTransaction: { create: jest.fn().mockResolvedValue({}) },
        user: { count: jest.fn().mockResolvedValue(0), update: jest.fn().mockResolvedValue({}) },
      });
      const { loyalty, pointsExpiresAt } = loyaltyWithExpiry();
      await missionService(prisma, loyalty).claimMission('u1', 'FIRST_ORDER');
      expect(pointsExpiresAt.mock.invocationCallOrder[0]!).toBeLessThan((prisma.$transaction as jest.Mock).mock.invocationCallOrder[0]!);
    });

    it('chưa đủ điều kiện → không đọc cấu hình hạn, không mở tx', async () => {
      const prisma = missionsPrisma({ order: settledOrders(0) });
      const { loyalty, pointsExpiresAt } = loyaltyWithExpiry();
      await expect(missionService(prisma, loyalty).claimMission('u1', 'FIRST_ORDER')).rejects.toBeInstanceOf(BadRequestException);
      expect(pointsExpiresAt).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('thiếu LoyaltyService → ném lỗi TRƯỚC khi mở tx/ghi claim (không để lọt điểm không hạn)', async () => {
      const missionProgressCreate = jest.fn();
      const prisma = missionsPrisma({ missionProgress: { create: missionProgressCreate } });
      await expect(missionService(prisma).claimMission('u1', 'FIRST_ORDER')).rejects.toThrow(/LoyaltyService/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(missionProgressCreate).not.toHaveBeenCalled();
    });
  });

  it('đã nhận rồi (unique userId+missionId+cycleKey → P2002) → BadRequest "đã nhận", KHÔNG cộng thêm điểm', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const missionProgressCreate = jest.fn().mockRejectedValue(p2002);
    const pointsCreate = jest.fn();
    const prisma = missionsPrisma({
      missionProgress: { create: missionProgressCreate },
      pointsTransaction: { create: pointsCreate },
    });
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);

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
        $queryRaw: async () => [],
        mission: { findUnique: async () => ({ disabledAt: null, rewardPoints: 20 }) },
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
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);

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
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);
    await svc.claimMission('u1', 'CHECKIN_7');
    expect(missionProgressCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cycleKey: '1' }) }),
    );
  });

  it('ENGAGE-11: nhiệm vụ không lặp lại đã nhận ở chu kỳ cũ → 400 "đã nhận", không mở tx, không cộng điểm', async () => {
    const pointsCreate = jest.fn();
    const findFirst = jest.fn().mockResolvedValue({ id: 'old', missionId: 'm1', cycleKey: '2' });
    const prisma = missionsPrisma({
      mission: {
        findUnique: jest.fn().mockResolvedValue({ id: 'm1', code: 'CHECKIN_7', goal: 7, rewardPoints: 30, isRepeatable: false, rewardCoupon: null }),
      },
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays: 21 }) },
      missionProgress: { findFirst },
      pointsTransaction: { create: pointsCreate },
    });
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);
    await expect(svc.claimMission('u1', 'CHECKIN_7')).rejects.toThrow('Bạn đã nhận thưởng nhiệm vụ này rồi.');
    expect(findFirst).toHaveBeenCalledWith({ where: { userId: 'u1', missionId: 'm1' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(pointsCreate).not.toHaveBeenCalled();
  });

  const REVIEW_3 = { id: 'm3', code: 'REVIEW_3', goal: 3, rewardPoints: 15, isRepeatable: false, rewardCoupon: null };

  it('REVIEW_3: ba đánh giá có ảnh của CÙNG một sản phẩm (ba lần mua) là một sản phẩm → chưa đủ điều kiện, không cộng điểm', async () => {
    const pointsCreate = jest.fn();
    const prisma = missionsPrisma({
      mission: { findUnique: jest.fn().mockResolvedValue(REVIEW_3) },
      review: { findMany: jest.fn().mockResolvedValue(reviewedProducts(1)) },
      order: settledOrders(1),
      pointsTransaction: { create: pointsCreate },
    });
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);
    await expect(svc.claimMission('u1', 'REVIEW_3')).rejects.toThrow('Chưa đủ điều kiện để nhận thưởng nhiệm vụ này.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(pointsCreate).not.toHaveBeenCalled();
  });

  it('REVIEW_3: ba sản phẩm khác nhau → nhận được, ghi tiến độ 3/3 ở chu kỳ "0"', async () => {
    const missionProgressCreate = jest.fn().mockResolvedValue({ id: 'mp1' });
    const prisma = missionsPrisma({
      mission: { findUnique: jest.fn().mockResolvedValue(REVIEW_3) },
      review: { findMany: jest.fn().mockResolvedValue(reviewedProducts(3)) },
      order: settledOrders(3),
      missionProgress: { create: missionProgressCreate },
    });
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);
    await expect(svc.claimMission('u1', 'REVIEW_3')).resolves.toMatchObject({ claimed: true, rewardPoints: 15 });
    expect(missionProgressCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ missionId: 'm3', cycleKey: '0', progress: 3, goal: 3 }) }),
    );
  });

  it('REVIEW_3 đã nhận theo cách đếm dòng cũ, nay chỉ còn một sản phẩm → báo "đã nhận" (không phải "chưa đủ điều kiện"), không mở tx', async () => {
    const prisma = missionsPrisma({
      mission: { findUnique: jest.fn().mockResolvedValue(REVIEW_3) },
      review: { findMany: jest.fn().mockResolvedValue(reviewedProducts(1)) },
      order: settledOrders(1),
      missionProgress: { findFirst: jest.fn().mockResolvedValue({ id: 'old', missionId: 'm3', cycleKey: '0' }) },
    });
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);
    await expect(svc.claimMission('u1', 'REVIEW_3')).rejects.toThrow('Bạn đã nhận thưởng nhiệm vụ này rồi.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ENGAGE-1: INVITE_3 với 3 tài khoản được mời nhưng chưa ai mua thành công → chưa đủ điều kiện', async () => {
    const prisma = missionsPrisma({
      mission: {
        findUnique: jest.fn().mockResolvedValue({ id: 'm4', code: 'INVITE_3', goal: 3, rewardPoints: 50, isRepeatable: false, rewardCoupon: null }),
      },
      user: { count: jest.fn().mockResolvedValue(3) },
    });
    const svc = new GameService(prisma, makeConfig(), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);
    await expect(svc.claimMission('u1', 'INVITE_3')).rejects.toThrow('Chưa đủ điều kiện để nhận thưởng nhiệm vụ này.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
      profile({ totalSeeds: 100, ecoImpact: { progress: 0, target: 30, treeType: 't', treesPlanted: 1 } }),
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

// C-040: đặc tả che tên `maskName` (cùng bảng ca ở game, game-gift, game-season).
const MASK_NAME_CASES: [string, string | null, string][] = [
  ['null -> mặc định', null, 'Bạn Tubu'],
  ['rỗng -> mặc định', '', 'Bạn Tubu'],
  ['chỉ khoảng trắng -> mặc định', '   ', 'Bạn Tubu'],
  ['một từ', 'Long', 'Long***'],
  ['nhiều từ -> từ cuối', 'Lã Hoàng Long', 'Long***'],
  ['thừa khoảng trắng đầu/cuối', '  Nguyễn An  ', 'An***'],
  ['hai dấu cách liền nhau', 'Lã  Long', 'Long***'],
  ['tab giữa tên -> tách như dấu cách', 'Lã\tLong', 'Long***'],
  ['nbsp giữa tên -> tách như dấu cách', 'Lã\u00a0Long', 'Long***'],
  ['khoảng trắng rộng 0 -> tách, không lộ họ tên', 'Nguyễn\u200bThị\u200bLan', 'Lan***'],
  ['toàn emoji -> mặc định', '🌸🌸', 'Bạn Tubu'],
  ['chỉ có phần trong ngoặc -> mặc định', '(Mẹ Bin)', 'Bạn Tubu'],
  ['số điện thoại -> mặc định, không in số', '0912345678', 'Bạn Tubu'],
  ['email -> mặc định, không in địa chỉ', 'an@mail.com', 'Bạn Tubu'],
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

  it('chỉ lấy người đã có chuỗi: hồ sơ chưa từng điểm danh không lấp bảng', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await new GameService(makePrisma({ gameProfile: { findMany } }), makeConfig(), analytics).getLeaderboard();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { longestStreak: { gt: 0 } } }));
  });
});

describe('GameService.waterTree — nhịp người mới (thang cây, cây mầm, trần tháng)', () => {
  const eco = (extra: Record<string, unknown> = {}) => ({
    progress: 0,
    target: 60,
    treeType: 'Cây Dứa Fuwa3e',
    treesPlanted: 0,
    ...extra,
  });
  const svcWith = (prisma: PrismaService, config = makeConfig(), loyalty = loyaltyWithExpiry().loyalty, a = analytics) =>
    new GameService(prisma, config, a, undefined, undefined, undefined, loyalty);
  const setProfile = (prisma: PrismaService, ecoImpact: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(profile({ totalSeeds: 2000, ecoImpact, ...extra }));
  const savedEco = (prisma: PrismaService) =>
    (prisma.gameProfile.updateMany as jest.Mock).mock.calls.at(-1)![0].data.ecoImpact as {
      progress: number;
      target: number;
      treesPlanted: number;
      sproutRewarded?: boolean;
    };

  it('thang [60,300,600] qua ba lần thu hoạch trong một lần tưới: 60 + 300 + 600, target kế tiếp = 600', async () => {
    const prisma = makePrisma();
    setProfile(prisma, eco());
    const r = await svcWith(prisma).waterTree('u1', 960);
    expect(r.treesPlanted).toBe(3);
    expect(r.target).toBe(600);
    expect(r.progress).toBe(0);
    expect(savedEco(prisma)).toEqual(expect.objectContaining({ target: 600, treesPlanted: 3, progress: 0 }));
  });

  it('nước dư chuyển sang target mới: 50 + 20 = 70, thu hoạch cây 60, dư 10 sang cây target 300', async () => {
    const prisma = makePrisma();
    setProfile(prisma, eco({ progress: 50 }));
    const r = await svcWith(prisma).waterTree('u1', 20);
    expect(r.harvested).toBe(true);
    expect(r.progress).toBe(10);
    expect(r.target).toBe(300);
    expect(savedEco(prisma)).toEqual(expect.objectContaining({ progress: 10, target: 300, treesPlanted: 1 }));
  });

  it('thang cây từ config: [10, 20] → cây 3 trở đi vẫn 20 (phần tử cuối)', async () => {
    const prisma = makePrisma();
    setProfile(prisma, eco({ target: 10 }));
    const r = await svcWith(prisma, makeConfig({ 'game.tree_target_ladder': [10, 20] })).waterTree('u1', 10 + 20 + 20);
    expect(r.treesPlanted).toBe(3);
    expect(r.target).toBe(20);
  });

  it('hồ sơ cũ 400/600 chưa có cây, khách thật: hạ về 60, thu hoạch cây mầm 2.000 điểm không mã, nước dư chảy sang cây 2 (target 300)', async () => {
    const prisma = makePrisma();
    setProfile(prisma, eco({ target: 600, progress: 400 }));
    (prisma.coupon.count as jest.Mock).mockResolvedValue(0);
    const { loyalty } = loyaltyWithExpiry();
    const r = await svcWith(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3 }), loyalty).waterTree('u1', 20); // 420: cây mầm ở 60, còn 360 → cây 2 ở 300, dư 60
    expect(r.treesPlanted).toBe(2);
    expect(r.progress).toBe(60);
    expect(r.target).toBe(600);
    expect(r.reward.sprout).toBe(true);
    expect(r.reward.points).toBe(2000);
    expect(prisma.pointsTransaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.coupon.create).toHaveBeenCalledTimes(1); // chỉ cây 2 có mã, cây mầm không
    expect(prisma.plantedTree.create).toHaveBeenCalledTimes(1);
    expect(savedEco(prisma).sproutRewarded).toBe(true);
  });

  it('hồ sơ cũ 400/600 + nước vừa đủ cho cây mầm (dư chưa tới 300): cây mầm, không mã, dư sang cây 2 target 300', async () => {
    const prisma = makePrisma();
    setProfile(prisma, eco({ target: 600, progress: 20 }));
    const { loyalty } = loyaltyWithExpiry();
    const r = await svcWith(prisma, makeConfig(), loyalty).waterTree('u1', 100); // 120: cây mầm ở 60, dư 60
    expect(r.treesPlanted).toBe(1);
    expect(r.progress).toBe(60);
    expect(r.target).toBe(300);
    expect(r.reward.points).toBe(2000);
    expect(r.reward.coupon).toBeUndefined();
    expect(r.reward.certificate).toBeUndefined();
    expect(prisma.plantedTree.create).not.toHaveBeenCalled();
  });

  it('hồ sơ cũ 0/600 không tiến độ: vẫn hạ về 60 và là cây mầm', async () => {
    const prisma = makePrisma();
    setProfile(prisma, eco({ target: 600, progress: 0 }));
    const { loyalty } = loyaltyWithExpiry();
    const r = await svcWith(prisma, makeConfig(), loyalty).waterTree('u1', 60);
    expect(r.harvested).toBe(true);
    expect(r.reward.sprout).toBe(true);
    expect(r.reward.points).toBe(2000);
    expect(r.reward.certificate).toBeUndefined();
    expect(prisma.plantedTree.create).not.toHaveBeenCalled();
  });

  it('guest cũ 400/600: cây mầm guest (không điểm, không mã), cờ ghi false; nâng cấp xong nhận điểm hoãn đúng một lần', async () => {
    const prisma = makePrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ zaloId: 'guest_x', phone: null });
    setProfile(prisma, eco({ target: 600, progress: 400 }));
    const r = await svcWith(prisma).waterTree('u1', 20);
    expect(r.rewardBlocked).toBe('GUEST');
    expect(r.reward.sprout).toBe(true);
    expect(r.reward.points).toBeUndefined();
    expect(r.reward.coupon).toBeUndefined();
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    const after = savedEco(prisma);
    expect(after.treesPlanted).toBeGreaterThanOrEqual(1);
    expect(after.sproutRewarded).toBe(false);

    const prisma2 = makePrisma();
    setProfile(prisma2, eco({ target: 300, progress: 100, treesPlanted: 1, sproutRewarded: false }));
    const { loyalty } = loyaltyWithExpiry();
    const up = await svcWith(prisma2, makeConfig(), loyalty).waterTree('u1', 200);
    expect(up.reward.points).toBe(2000);
    expect(prisma2.pointsTransaction.create).toHaveBeenCalledTimes(1);
    expect(savedEco(prisma2).sproutRewarded).toBe(true);
  });

  it('hồ sơ cũ đã có ≥1 cây giữ nguyên target đã lưu (600), không hạ', async () => {
    const prisma = makePrisma();
    setProfile(prisma, eco({ target: 600, progress: 400, treesPlanted: 1 }));
    const r = await svcWith(prisma).waterTree('u1', 100);
    expect(r.harvested).toBe(false);
    expect(r.target).toBe(600);
    expect(r.progress).toBe(500);
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
  });

  describe('cây mầm (thu hoạch đầu tiên)', () => {
    it('thưởng 2.000 Điểm Xanh có hạn, KHÔNG mã, KHÔNG ghi góp quỹ cây, trả reward.points', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco());
      const { loyalty, pointsExpiresAt } = loyaltyWithExpiry();
      const r = await svcWith(prisma, makeConfig(), loyalty).waterTree('u1', 60);
      expect(r.harvested).toBe(true);
      expect(r.treesPlanted).toBe(1);
      expect(r.reward.points).toBe(2000);
      expect(r.reward.coupon).toBeUndefined();
      expect(r.reward.certificate).toBeUndefined();
      expect(prisma.coupon.create).not.toHaveBeenCalled();
      expect(prisma.plantedTree.create).not.toHaveBeenCalled();
      expect(pointsExpiresAt).toHaveBeenCalledTimes(1);
      expect(prisma.pointsTransaction.create).toHaveBeenCalledWith({
        data: { userId: 'u1', delta: 2000, reason: 'GAME_FIRST_HARVEST', refType: 'GAME', expiresAt: REWARD_EXPIRES_AT },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsBalance: { increment: 2000 } } });
    });

    it('điểm cây mầm theo config game.first_harvest_points', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco());
      const r = await svcWith(prisma, makeConfig({ 'game.first_harvest_points': 500 })).waterTree('u1', 60);
      expect(r.reward.points).toBe(500);
    });

    it('game.first_harvest_points = 0 → không thưởng điểm, vẫn không mã và không góp quỹ', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco());
      const r = await svcWith(prisma, makeConfig({ 'game.first_harvest_points': 0 })).waterTree('u1', 60);
      expect(r.harvested).toBe(true);
      expect(r.reward.points).toBeUndefined();
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
      expect(prisma.coupon.create).not.toHaveBeenCalled();
      expect(prisma.plantedTree.create).not.toHaveBeenCalled();
    });

    it('khách vãng lai (zaloId guest_…) KHÔNG nhận điểm; vẫn thu hoạch, không mã', async () => {
      const prisma = makePrisma();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ zaloId: 'guest_abc123' });
      setProfile(prisma, eco());
      const { loyalty, pointsExpiresAt } = loyaltyWithExpiry();
      const r = await svcWith(prisma, makeConfig(), loyalty).waterTree('u1', 60);
      expect(r.harvested).toBe(true);
      expect(r.treesPlanted).toBe(1);
      expect(r.reward.points).toBeUndefined();
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(pointsExpiresAt).not.toHaveBeenCalled();
      expect(prisma.coupon.create).not.toHaveBeenCalled();
    });

    it('chỉ lần thu hoạch ĐẦU: hồ sơ đã có 1 cây thì cây thứ hai có mã + góp quỹ, không điểm', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco({ target: 300, treesPlanted: 1 }));
      const { loyalty, pointsExpiresAt } = loyaltyWithExpiry();
      const r = await svcWith(prisma, makeConfig(), loyalty).waterTree('u1', 300);
      expect(r.treesPlanted).toBe(2);
      expect(r.reward.coupon).toBeTruthy();
      expect(r.reward.certificate).toMatch(/^TUBU-/);
      expect(r.reward.points).toBeUndefined();
      expect(prisma.plantedTree.create).toHaveBeenCalledTimes(1);
      expect(pointsExpiresAt).not.toHaveBeenCalled();
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    });

    it('một lần tưới 360 từ hồ sơ mới: cây mầm (điểm) rồi cây 2 (mã + góp quỹ)', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco());
      const r = await svcWith(prisma).waterTree('u1', 360);
      expect(r.treesPlanted).toBe(2);
      expect(r.reward.points).toBe(2000);
      expect(r.reward.coupon).toBeTruthy();
      expect(prisma.plantedTree.create).toHaveBeenCalledTimes(1);
      expect(prisma.coupon.create).toHaveBeenCalledTimes(1);
    });

    it('thiếu LoyaltyService mà đủ điều kiện nhận điểm → dừng và không ghi dòng điểm không hạn', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco());
      await expect(new GameService(prisma, makeConfig(), analytics).waterTree('u1', 60)).rejects.toThrow(/LoyaltyService/);
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('cờ sproutRewarded, khách thật và bài tự đăng', () => {
    const feedMock = () => ({ createAchievementPost: jest.fn().mockResolvedValue({}) });
    const withFeed = (prisma: PrismaService, feed: unknown, config = makeConfig()) =>
      new GameService(prisma, config, analytics, undefined, undefined, feed as never, loyaltyWithExpiry().loyalty);
    const saved = (prisma: PrismaService) =>
      (prisma.gameProfile.updateMany as jest.Mock).mock.calls.at(-1)![0].data.ecoImpact as Record<string, unknown>;

    it('cây mầm bật cờ sproutRewarded trong cùng ecoImpact đã lưu', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco({ sproutRewarded: false }));
      const r = await svcWith(prisma).waterTree('u1', 60);
      expect(r.reward.points).toBe(2000);
      expect(saved(prisma).sproutRewarded).toBe(true);
    });

    it('cờ đã bật → không cộng điểm nữa', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco({ target: 300, treesPlanted: 1, sproutRewarded: true }));
      const r = await svcWith(prisma).waterTree('u1', 300);
      expect(r.reward.points).toBeUndefined();
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    });

    it('guest thu hoạch cây mầm: treesPlanted = 1, KHÔNG điểm, cờ vẫn chưa bật, rewardBlocked = GUEST', async () => {
      const prisma = makePrisma();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ zaloId: 'guest_x', phone: null });
      setProfile(prisma, eco({ sproutRewarded: false }));
      const r = await svcWith(prisma).waterTree('u1', 60);
      expect(r.treesPlanted).toBe(1);
      expect(r.rewardBlocked).toBe('GUEST');
      expect(r.reward.points).toBeUndefined();
      expect(saved(prisma).sproutRewarded).toBe(false);
    });

    it('guest đã nâng cấp (cờ false, đã có 1 cây): lần thu hoạch tiếp được cộng điểm cây mầm MỘT lần, kèm mã của cây đó', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco({ target: 300, treesPlanted: 1, sproutRewarded: false }));
      const r = await svcWith(prisma).waterTree('u1', 300);
      expect(r.reward.points).toBe(2000);
      expect(r.reward.coupon).toBeTruthy();
      expect(saved(prisma).sproutRewarded).toBe(true);
      expect(prisma.pointsTransaction.create).toHaveBeenCalledTimes(1);
    });

    it('một lần tưới thu hoạch 2 cây khi cờ chưa bật: điểm cây mầm chỉ cộng một lần', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco({ sproutRewarded: false }));
      await svcWith(prisma).waterTree('u1', 360);
      expect(prisma.pointsTransaction.create).toHaveBeenCalledTimes(1);
    });

    it('hồ sơ cũ không có cờ và đã có cây (treesPlanted > 0) → coi như đã xong, không cộng bù', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco({ target: 300, treesPlanted: 1 }));
      const r = await svcWith(prisma).waterTree('u1', 300);
      expect(r.reward.points).toBeUndefined();
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    });

    it('sổ điểm đã có GAME_FIRST_HARVEST nhưng cờ chưa bật → chỉ bật cờ, không cộng lại', async () => {
      const prisma = makePrisma();
      (prisma.pointsTransaction.findFirst as jest.Mock).mockResolvedValue({ id: 'old' });
      setProfile(prisma, eco({ sproutRewarded: false }));
      const r = await svcWith(prisma).waterTree('u1', 60);
      expect(r.reward.points).toBeUndefined();
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
      expect(saved(prisma).sproutRewarded).toBe(true);
    });

    it('guest chưa SĐT thu hoạch cây thứ hai: có chứng nhận, KHÔNG mã, rewardBlocked = GUEST', async () => {
      const prisma = makePrisma();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ zaloId: 'guest_x', phone: null });
      setProfile(prisma, eco({ target: 300, treesPlanted: 1, sproutRewarded: false }));
      const r = await svcWith(prisma).waterTree('u1', 300);
      expect(r.rewardBlocked).toBe('GUEST');
      expect(r.reward.coupon).toBeUndefined();
      expect(r.reward.certificate).toMatch(/^TUBU-/);
      expect(prisma.coupon.create).not.toHaveBeenCalled();
      expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    });

    it('guest đã xác thực SĐT được coi là khách thật: nhận điểm cây mầm', async () => {
      const prisma = makePrisma();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ zaloId: 'guest_x', phone: '0900000000' });
      setProfile(prisma, eco({ sproutRewarded: false }));
      const r = await svcWith(prisma).waterTree('u1', 60);
      expect(r.reward.points).toBe(2000);
      expect(r.rewardBlocked).toBeUndefined();
    });

    it('mã thu hoạch lô nhà mang tiền tố HARVEST (không phải GAME)', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco({ target: 300, treesPlanted: 1, sproutRewarded: true }));
      await svcWith(prisma).waterTree('u1', 300);
      expect((prisma.coupon.create as jest.Mock).mock.calls[0][0].data.code).toMatch(/^HARVEST/);
    });

    it('một lần tưới ra nhiều mã: coupons[] đủ mã, coupon là mã đầu tiên', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco({ target: 300, treesPlanted: 1, sproutRewarded: true }));
      const r = await svcWith(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 9, 'game.harvest_coupon_monthly_cap': 9 })).waterTree('u1', 900);
      expect(r.reward.coupons).toHaveLength(2);
      expect(r.reward.coupon).toBe(r.reward.coupons![0]);
    });

    it('hồ sơ cũ target 600, chưa tưới, 0 cây → hạ về bậc đầu của thang và có cây mầm 60', async () => {
      const prisma = makePrisma();
      setProfile(prisma, { progress: 0, target: 600, treeType: 't', treesPlanted: 0 });
      const r = await svcWith(prisma).waterTree('u1', 60);
      expect(r.treesPlanted).toBe(1);
      expect(r.reward.points).toBe(2000);
    });

    it('thu hoạch (cây mầm, khách guest, khách thật cây thứ hai) không bao giờ tự đăng bài bảng tin', async () => {
      const p1 = makePrisma();
      setProfile(p1, eco({ sproutRewarded: false }));
      const f1 = feedMock();
      await withFeed(p1, f1).waterTree('u1', 60);

      const p2 = makePrisma();
      (p2.user.findUnique as jest.Mock).mockResolvedValue({ zaloId: 'guest_x', phone: null });
      setProfile(p2, eco({ target: 300, treesPlanted: 1 }));
      const f2 = feedMock();
      await withFeed(p2, f2).waterTree('u1', 300);

      const p3 = makePrisma();
      setProfile(p3, eco({ target: 300, treesPlanted: 1, sproutRewarded: true }));
      const f3 = feedMock();
      await withFeed(p3, f3).waterTree('u1', 300);

      for (const f of [f1, f2, f3]) expect(f.createAchievementPost).not.toHaveBeenCalled();
    });
  });

  describe('ngày 1 giờ VN', () => {
    afterEach(() => jest.useRealTimers());
    it('ngày 1 giờ VN (31/10 20:00Z): mốc ngày = mốc tháng, trần ngày vẫn được xét trước; mã GAME không được đếm', async () => {
      freezeNow('2026-10-31T20:00:00Z');
      const prisma = makePrisma();
      setProfile(prisma, eco({ target: 300, treesPlanted: 1, sproutRewarded: true }));
      (prisma.coupon.count as jest.Mock).mockResolvedValue(3);
      const r = await svcWith(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3 })).waterTree('u1', 300);
      const [dayCall, monthCall] = (prisma.coupon.count as jest.Mock).mock.calls.map((c) => c[0].where);
      expect(dayCall.startAt.gte.toISOString()).toBe('2026-10-31T17:00:00.000Z');
      expect(monthCall.startAt.gte.toISOString()).toBe('2026-10-31T17:00:00.000Z');
      expect(dayCall.OR).toEqual([{ code: { startsWith: 'HARVEST' } }, { code: { startsWith: 'GARDEN' } }]);
      expect(r.couponCapped).toBe('DAY');
    });
  });

  describe('trần mã thu hoạch tháng', () => {
    beforeEach(() => freezeNow('2026-10-15T05:00:00Z'));
    afterEach(() => jest.useRealTimers());
    const secondTree = () => eco({ target: 300, treesPlanted: 1 });

    it('đếm mã HARVEST và GARDEN (không đếm GAME của vòng quay/nhiệm vụ) từ đầu tháng giờ VN; đủ 4 → không cấp mã, couponCapped = MONTH, vẫn thu hoạch + góp quỹ', async () => {
      const prisma = makePrisma();
      setProfile(prisma, secondTree());
      const monthStart = startOfVnMonth().getTime();
      (prisma.coupon.count as jest.Mock).mockImplementation(async ({ where }: { where: { startAt: { gte: Date } } }) =>
        where.startAt.gte.getTime() === monthStart ? 4 : 0,
      );
      const r = await svcWith(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3 })).waterTree('u1', 300);
      expect(r.harvested).toBe(true);
      expect(r.couponCapped).toBe('MONTH');
      expect(r.reward.coupon).toBeUndefined();
      expect(prisma.coupon.create).not.toHaveBeenCalled();
      expect(prisma.plantedTree.create).toHaveBeenCalledTimes(1);
      const where = (prisma.coupon.count as jest.Mock).mock.calls.map((c) => c[0].where).find((w) => w.startAt.gte.getTime() === monthStart);
      expect(where.OR).toEqual([{ code: { startsWith: 'HARVEST' } }, { code: { startsWith: 'GARDEN' } }]);
      expect(where.scopeMeta).toEqual({ path: ['userId'], equals: 'u1' });
    });

    it('còn 1 suất tháng (3/4) mà một lần tưới thu hoạch 2 cây → cây đầu có mã, cây sau bị trần MONTH', async () => {
      const prisma = makePrisma();
      setProfile(prisma, eco({ target: 300, treesPlanted: 1 }));
      const monthStart = startOfVnMonth().getTime();
      (prisma.coupon.count as jest.Mock).mockImplementation(async ({ where }: { where: { startAt: { gte: Date } } }) =>
        where.startAt.gte.getTime() === monthStart ? 3 : 0,
      );
      const r = await svcWith(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3 })).waterTree('u1', 300 + 600);
      expect(r.treesPlanted).toBe(3);
      expect(prisma.coupon.create).toHaveBeenCalledTimes(1);
      expect(r.couponCapped).toBe('MONTH');
    });

    it('trần tháng theo config game.harvest_coupon_monthly_cap', async () => {
      const prisma = makePrisma();
      setProfile(prisma, secondTree());
      const monthStart = startOfVnMonth().getTime();
      (prisma.coupon.count as jest.Mock).mockImplementation(async ({ where }: { where: { startAt: { gte: Date } } }) =>
        where.startAt.gte.getTime() === monthStart ? 4 : 0,
      );
      const r = await svcWith(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 3, 'game.harvest_coupon_monthly_cap': 5 })).waterTree('u1', 300);
      expect(r.reward.coupon).toBeTruthy();
      expect(r).not.toHaveProperty('couponCapped');
    });

    it.each([
      ['trần ngày = 0', { 'game.harvest_coupon_daily_cap': 0 }],
      ['trần tháng = 0', { 'game.harvest_coupon_monthly_cap': 0 }],
    ])('admin đặt %s (tắt mã) → couponCapped = OFF, không cấp mã, vẫn thu hoạch và góp quỹ', async (_n, cfg) => {
      const prisma = makePrisma();
      setProfile(prisma, secondTree());
      const r = await svcWith(prisma, makeConfig(cfg)).waterTree('u1', 300);
      expect(r.couponCapped).toBe('OFF');
      expect(r.harvested).toBe(true);
      expect(prisma.coupon.create).not.toHaveBeenCalled();
      expect(prisma.plantedTree.create).toHaveBeenCalledTimes(1);
    });

    it('đủ trần ngày (1/ngày), tháng còn suất → couponCapped = DAY', async () => {
      const prisma = makePrisma();
      setProfile(prisma, secondTree());
      const monthStart = startOfVnMonth().getTime();
      (prisma.coupon.count as jest.Mock).mockImplementation(async ({ where }: { where: { startAt: { gte: Date } } }) =>
        where.startAt.gte.getTime() === monthStart ? 0 : 1,
      );
      const r = await svcWith(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 1 })).waterTree('u1', 300);
      expect(r.couponCapped).toBe('DAY');
      expect(prisma.coupon.create).not.toHaveBeenCalled();
    });

    it('đủ cả trần ngày lẫn trần tháng → báo MONTH (tháng được xét trước ngày)', async () => {
      const prisma = makePrisma();
      setProfile(prisma, secondTree());
      (prisma.coupon.count as jest.Mock).mockResolvedValue(9);
      const r = await svcWith(prisma, makeConfig({ 'game.harvest_coupon_daily_cap': 1 })).waterTree('u1', 300);
      expect(r.couponCapped).toBe('MONTH');
      expect(prisma.coupon.create).not.toHaveBeenCalled();
    });

    it('không đặt config: trần ngày dự phòng là 1, trần tháng dự phòng là 4', async () => {
      const dayFull = makePrisma();
      setProfile(dayFull, secondTree());
      (dayFull.coupon.count as jest.Mock).mockResolvedValue(1);
      const day = await svcWith(dayFull).waterTree('u1', 300);
      expect(day.couponCapped).toBe('DAY');
      expect(dayFull.coupon.create).not.toHaveBeenCalled();

      const monthFull = makePrisma();
      setProfile(monthFull, secondTree());
      const monthStart = startOfVnMonth().getTime();
      (monthFull.coupon.count as jest.Mock).mockImplementation(async ({ where }: { where: { startAt: { gte: Date } } }) =>
        where.startAt.gte.getTime() === monthStart ? 4 : 0,
      );
      const month = await svcWith(monthFull).waterTree('u1', 300);
      expect(month.couponCapped).toBe('MONTH');
    });

    it('chưa chạm trần nào → có mã, không có couponCapped; cây mầm không bao giờ có couponCapped', async () => {
      const prisma = makePrisma();
      setProfile(prisma, secondTree());
      const ok = await svcWith(prisma).waterTree('u1', 300);
      expect(ok.reward.coupon).toBeTruthy();
      expect(ok).not.toHaveProperty('couponCapped');

      const p2 = makePrisma();
      setProfile(p2, eco());
      (p2.coupon.count as jest.Mock).mockResolvedValue(99);
      const sprout = await svcWith(p2).waterTree('u1', 60);
      expect(sprout).not.toHaveProperty('couponCapped');
    });
  });

  it('cây quá death_days giữ tiến độ: 8 ngày không tưới, progress 50/60 + 20 → thu hoạch như bình thường', async () => {
    const prisma = makePrisma();
    setProfile(prisma, eco({ progress: 50 }), { lastWateredAt: new Date(Date.now() - 8 * DAY_MS) });
    const r = await svcWith(prisma).waterTree('u1', 20);
    expect(r.revivedFromDead).toBe(false);
    expect(r.harvested).toBe(true);
    expect(r.progress).toBe(10);
  });

  it('đo lường: mỗi lần thu hoạch ghi harvest kèm số thứ tự cây (qua record(tx) trong cùng giao dịch)', async () => {
    const prisma = makePrisma();
    setProfile(prisma, eco());
    const spy = { record: jest.fn().mockResolvedValue(undefined), recordBestEffort: jest.fn() } as unknown as AnalyticsEventsService;
    await svcWith(prisma, makeConfig(), loyaltyWithExpiry().loyalty, spy).waterTree('u1', 360);
    const props = (spy.record as jest.Mock).mock.calls.map((c) => c[1].props);
    expect(props).toEqual([
      { action: 'harvest', treeNo: 1 },
      { action: 'harvest', treeNo: 2 },
      { action: 'water_tree', drops: 360 },
    ]);
    for (const c of (spy.record as jest.Mock).mock.calls) {
      expect(c[0]).toBe(prisma);
      expect(c[1]).toEqual(expect.objectContaining({ eventName: 'engagement_action', userId: 'u1' }));
    }
  });

  it('hồ cộng đồng: góp đúng tổng nước đã nuôi các cây vừa thu hoạch (60 + 300), không nhân target mới', async () => {
    const prisma = makePrisma();
    setProfile(prisma, eco());
    const community = { contribute: jest.fn().mockResolvedValue(undefined) };
    const svc = new GameService(prisma, makeConfig(), analytics, community as never, undefined, undefined, loyaltyWithExpiry().loyalty);
    await svc.waterTree('u1', 360);
    expect(community.contribute).toHaveBeenCalledWith('u1', 360);
  });
});

describe('GameService.getProfile — số hiện trước khi bấm', () => {
  const run = async (profileExtra: Record<string, unknown>, config: Record<string, unknown> = {}) => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ lastCheckInAt: null, ecoImpact: { progress: 0, target: 60, treeType: 't', treesPlanted: 0 }, ...profileExtra }),
    );
    return new GameService(prisma, makeConfig(config), analytics).getProfile('u1');
  };

  it('trả dailyLoginSeeds, dewSeeds, streak7Seeds, quizWrongSeeds từ config; target hiện tại và kế tiếp theo thang', async () => {
    const r = await run(
      {},
      { 'game.daily_login_seeds': 15, 'game.dew_seeds': 15, 'game.streak_7_bonus': { seeds: 30 }, 'game.quiz_wrong_seeds': 2 },
    );
    expect(r).toEqual(
      expect.objectContaining({
        dailyLoginSeeds: 15,
        dewSeeds: 15,
        streak7Seeds: 30,
        quizWrongSeeds: 2,
        currentTreeTarget: 60,
        nextTreeTarget: 300,
      }),
    );
  });

  it('firstCheckinBonus = 50 khi chưa điểm danh lần nào, 0 khi đã điểm danh', async () => {
    expect((await run({})).firstCheckinBonus).toBe(50);
    expect((await run({ lastCheckInAt: new Date(Date.now() - DAY_MS) })).firstCheckinBonus).toBe(0);
  });

  it('firstCheckinBonus theo config', async () => {
    expect((await run({}, { 'game.first_checkin_bonus': 80 })).firstCheckinBonus).toBe(80);
  });

  it('nextTreeTarget theo số cây đã trồng: cây đang trồng là cây thứ 2 (đã có 1) → kế tiếp 600', async () => {
    const r = await run({ ecoImpact: { progress: 10, target: 300, treeType: 't', treesPlanted: 1 } });
    expect(r.currentTreeTarget).toBe(300);
    expect(r.nextTreeTarget).toBe(600);
  });

  it('hồ sơ cũ target 600, chưa có cây: currentTreeTarget hạ về 60, nextTreeTarget = 300 (bậc 2)', async () => {
    const r = await run({ ecoImpact: { progress: 100, target: 600, treeType: 't', treesPlanted: 0 } });
    expect(r.currentTreeTarget).toBe(60);
    expect(r.nextTreeTarget).toBe(300);
  });

  it('ecoImpact trả về dùng cùng target đã chuẩn hoá với lúc tưới: chưa có cây → 60 (kể cả có tiến độ); đã có cây → giữ nguyên', async () => {
    const fresh = await run({ ecoImpact: { progress: 0, target: 600, treeType: 't', treesPlanted: 0 } });
    expect(fresh.ecoImpact).toEqual(expect.objectContaining({ progress: 0, target: 60, treesPlanted: 0 }));
    const watered = await run({ ecoImpact: { progress: 100, target: 600, treeType: 't', treesPlanted: 0 } });
    // Đã tưới vượt đích khi chưa có cây: hiện kẹp ở 60/60 (B-107), phần dư tính ở lần thu hoạch.
    expect(watered.ecoImpact).toEqual(expect.objectContaining({ progress: 60, target: 60 }));
    const planted = await run({ ecoImpact: { progress: 100, target: 600, treeType: 't', treesPlanted: 1 } });
    expect(planted.ecoImpact).toEqual(expect.objectContaining({ progress: 100, target: 600, treesPlanted: 1 }));
  });

  it('khoá thiếu → mặc định mã khớp hành vi các nút (đủ để FE hiện trước khi bấm)', async () => {
    const r = await run({});
    expect(r.dailyLoginSeeds).toBe(10);
    expect(r.dewSeeds).toBe(15);
    expect(r.streak7Seeds).toBe(20);
    expect(r.quizWrongSeeds).toBe(2);
  });
});

describe('GameService — hồ sơ cũ đã tưới vượt đích (B-107)', () => {
  const legacy = () =>
    profile({ totalSeeds: 0, ecoImpact: { progress: 400, target: 60, treeType: 't', treesPlanted: 0 } });

  it('getProfile kẹp tiến độ ở đích và báo harvestReady, không đợi lần tưới kế', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(legacy());
    const r = (await new GameService(prisma, makeConfig(), analytics).getProfile('u1')) as {
      ecoImpact: { progress: number; target: number };
      harvestReady: boolean;
    };
    expect(r.ecoImpact).toMatchObject({ progress: 60, target: 60 });
    expect(r.harvestReady).toBe(true);
  });

  it('hồ sơ bình thường: harvestReady = false, tiến độ giữ nguyên', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ ecoImpact: { progress: 10, target: 60, treeType: 't', treesPlanted: 0 } }),
    );
    const r = (await new GameService(prisma, makeConfig(), analytics).getProfile('u1')) as { ecoImpact: { progress: number }; harvestReady: boolean };
    expect(r.ecoImpact.progress).toBe(10);
    expect(r.harvestReady).toBe(false);
  });

  it('waterTree(0) thu hoạch phần nước đã đủ, không trừ giọt nào', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(legacy());
    const r = await new GameService(prisma, makeConfig(), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty).waterTree('u1', 0);
    expect(r.harvested).toBe(true);
    expect(r.treesPlanted).toBeGreaterThanOrEqual(1);
    expect(r.progress).toBeLessThan(r.target);
  });

  it('waterTree(0) khi cây chưa đủ nước → lỗi', async () => {
    const prisma = makePrisma();
    (prisma.gameProfile.findUnique as jest.Mock).mockResolvedValue(
      profile({ totalSeeds: 50, ecoImpact: { progress: 10, target: 60, treeType: 't', treesPlanted: 0 } }),
    );
    await expect(new GameService(prisma, makeConfig(), analytics).waterTree('u1', 0)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Nhiệm vụ quản trị thêm: chỉ tính việc từ lúc tạo (startsAt)', () => {
  const NOW = '2026-10-26T05:00:00.000Z';
  const custom = (over: Record<string, unknown>) => ({
    id: 'mc', code: 'CUSTOM_1', kind: 'ORDER_COUNT', title: 'Mua 1 đơn', description: '', goal: 1, rewardPoints: 10_000, isRepeatable: false,
    disabledAt: null, startsAt: new Date(NOW), ...over,
  });
  const svc = (prisma: PrismaService) => new GameService(prisma, makeConfig(), analytics, undefined, undefined, undefined, loyaltyWithExpiry().loyalty);
  beforeEach(() => freezeNow(NOW));
  afterEach(() => jest.useRealTimers());

  it('khách cũ đã có đơn giao trước khi nhiệm vụ ra đời: tiến độ 0, không nhận được thưởng', async () => {
    const create = jest.fn();
    const prisma = makePrisma({
      order: settledOrders(1), // đơn giao 30 ngày trước
      mission: { findMany: jest.fn().mockResolvedValue([custom({})]), findUnique: jest.fn().mockResolvedValue(custom({})) },
      missionProgress: { findMany: jest.fn().mockResolvedValue([]), create },
    });
    const [m] = await svc(prisma).getMissions('u1');
    expect(m).toMatchObject({ progress: 0, completed: false, kind: 'ORDER_COUNT' });
    await expect(svc(prisma).claimMission('u1', 'CUSTOM_1')).rejects.toThrow('Chưa đủ điều kiện');
    expect(create).not.toHaveBeenCalled();
  });

  it('đơn giao sau mốc bắt đầu và đã qua hạn đổi/trả thì tính', async () => {
    const startsAt = new Date(Date.now() - 20 * DAY_MS);
    const prisma = makePrisma({
      order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 30), deliveredOrder('o2', 10)]) },
      mission: { findMany: jest.fn().mockResolvedValue([custom({ startsAt })]) },
    });
    const [m] = await svc(prisma).getMissions('u1');
    expect(m).toMatchObject({ progress: 1, completed: true });
  });

  const checkinMission = (goal: number) => custom({ id: 'mk', code: 'CUSTOM_2', kind: 'CHECKIN_STREAK', goal });
  const withCheckin = (streakDays: number, lastCheckInAt: Date | null, goal: number, extra: Record<string, Date | null> = {}) =>
    makePrisma({
      gameProfile: { findUnique: jest.fn().mockResolvedValue({ streakDays, lastCheckInAt, ...extra }) },
      mission: { findMany: jest.fn().mockResolvedValue([checkinMission(goal)]), findUnique: jest.fn().mockResolvedValue(checkinMission(goal)) },
    });

  it('điểm danh: chuỗi 7 ngày có từ trước không tính, chỉ tính số ngày kể từ lúc tạo (hôm tạo là ngày 1)', async () => {
    const prisma = withCheckin(7, new Date(NOW), 7);
    expect((await svc(prisma).getMissions('u1'))[0]).toMatchObject({ progress: 1, completed: false });
    jest.setSystemTime(new Date('2026-10-28T05:00:00.000Z'));
    const p2 = withCheckin(7, new Date('2026-10-28T03:00:00.000Z'), 7);
    expect((await svc(p2).getMissions('u1'))[0]).toMatchObject({ progress: 3 });
  });

  it('điểm danh lần cuối từ rất lâu trước mốc (chuỗi cũ còn nằm trong hồ sơ): tiến độ 0, không nhận thưởng mục tiêu 1', async () => {
    const prisma = withCheckin(5, new Date(Date.parse(NOW) - 200 * DAY_MS), 1);
    expect((await svc(prisma).getMissions('u1'))[0]).toMatchObject({ progress: 0, completed: false });
    await expect(svc(prisma).claimMission('u1', 'CUSTOM_2')).rejects.toThrow('Chưa đủ điều kiện');
  });

  it('điểm danh lần cuối 9 ngày trước mốc, chuỗi 10: hai ngày sau mốc vẫn 0, không hoàn thành mục tiêu 3', async () => {
    const prisma = withCheckin(10, new Date(Date.parse(NOW) - 9 * DAY_MS), 3);
    jest.setSystemTime(new Date('2026-10-28T05:00:00.000Z'));
    expect((await svc(prisma).getMissions('u1'))[0]).toMatchObject({ progress: 0, completed: false });
    await expect(svc(prisma).claimMission('u1', 'CUSTOM_2')).rejects.toThrow('Chưa đủ điều kiện');
  });

  it('chuỗi đã đứt sau mốc (lần cuối trước hôm qua) cũng là 0; điểm danh hôm qua thì còn tính', async () => {
    jest.setSystemTime(new Date('2026-10-30T05:00:00.000Z'));
    const broken = withCheckin(4, new Date('2026-10-27T05:00:00.000Z'), 3);
    expect((await svc(broken).getMissions('u1'))[0]).toMatchObject({ progress: 0 });
    const alive = withCheckin(4, new Date('2026-10-29T05:00:00.000Z'), 3);
    expect((await svc(alive).getMissions('u1'))[0]).toMatchObject({ progress: 3, completed: true });
  });

  it('chuỗi hồi sinh sau mốc: chỉ đếm từ ngày hồi sinh, không cộng các ngày chuỗi cũ được hồi sinh vào (chuỗi 11, mốc ngày 26, hồi sinh ngày 29 → 1/3)', async () => {
    jest.setSystemTime(new Date('2026-10-29T05:00:00.000Z'));
    const day29 = new Date('2026-10-29T03:00:00.000Z');
    const repaired = withCheckin(11, day29, 3, { lastStreakRepairAt: day29 });
    expect((await svc(repaired).getMissions('u1'))[0]).toMatchObject({ progress: 1, completed: false });
    await expect(svc(repaired).claimMission('u1', 'CUSTOM_2')).rejects.toThrow('Chưa đủ điều kiện');
    const earlier = withCheckin(4, day29, 3, { lastStreakRepairAt: new Date('2026-10-10T03:00:00.000Z') });
    expect((await svc(earlier).getMissions('u1'))[0]).toMatchObject({ progress: 3, completed: true });
  });

  it('vé giữ lửa dùng sau mốc: ngày lỡ không phải ngày điểm danh, chỉ đếm từ ngày dùng vé (chuỗi 7, mốc ngày 26, vé ngày 28 → 1/3; ngày 29 điểm danh tiếp → 2/3)', async () => {
    jest.setSystemTime(new Date('2026-10-28T05:00:00.000Z'));
    const froze = withCheckin(7, new Date('2026-10-28T03:00:00.000Z'), 3, { lastStreakFreezeAt: new Date('2026-10-28T03:00:00.000Z') });
    expect((await svc(froze).getMissions('u1'))[0]).toMatchObject({ progress: 1, completed: false });
    jest.setSystemTime(new Date('2026-10-29T05:00:00.000Z'));
    const next = withCheckin(8, new Date('2026-10-29T03:00:00.000Z'), 3, { lastStreakFreezeAt: new Date('2026-10-28T03:00:00.000Z') });
    expect((await svc(next).getMissions('u1'))[0]).toMatchObject({ progress: 2, completed: false });
  });

  it('thẻ điểm danh có mốc nói nhiệm vụ đếm lại từ ngày dùng vé/hồi sinh; không hiện khi chưa dùng hoặc dùng trước mốc', async () => {
    jest.setSystemTime(new Date('2026-10-29T05:00:00.000Z'));
    const day29 = new Date('2026-10-29T03:00:00.000Z');
    const note = 'Dùng vé giữ lửa hay hồi sinh chuỗi thì nhiệm vụ đếm lại từ ngày đó.';
    const repaired = await svc(withCheckin(11, day29, 3, { lastStreakRepairAt: day29 })).getMissions('u1');
    expect(repaired[0]!.description).toContain(note);
    const froze = await svc(withCheckin(7, day29, 3, { lastStreakFreezeAt: day29 })).getMissions('u1');
    expect(froze[0]!.description).toContain(note);
    const plain = await svc(withCheckin(3, day29, 3)).getMissions('u1');
    expect(plain[0]!.description).not.toContain(note);
    const before = await svc(withCheckin(4, day29, 3, { lastStreakRepairAt: new Date('2026-10-10T03:00:00.000Z') })).getMissions('u1');
    expect(before[0]!.description).not.toContain(note);
  });

  it('đánh giá viết SAU mốc cho đơn giao TRƯỚC mốc vẫn tính; đánh giá viết trước mốc thì không', async () => {
    const startsAt = new Date(Date.now() - 20 * DAY_MS);
    const mk = (reviews: { productId: string; orderId: string; createdAt: Date }[]) =>
      makePrisma({
        order: { findMany: jest.fn().mockResolvedValue([deliveredOrder('o1', 30), deliveredOrder('o2', 30)]) },
        review: { findMany: jest.fn().mockResolvedValue(reviews) },
        mission: { findMany: jest.fn().mockResolvedValue([custom({ kind: 'REVIEW_COUNT', goal: 2, startsAt })]) },
      });
    const after = new Date(Date.now() - 5 * DAY_MS);
    const before = new Date(Date.now() - 25 * DAY_MS);
    const ok = await svc(mk([{ productId: 'p1', orderId: 'o1', createdAt: after }, { productId: 'p2', orderId: 'o2', createdAt: after }])).getMissions('u1');
    expect(ok[0]).toMatchObject({ progress: 2, completed: true });
    const old = await svc(mk([{ productId: 'p1', orderId: 'o1', createdAt: before }, { productId: 'p2', orderId: 'o2', createdAt: after }])).getMissions('u1');
    expect(old[0]).toMatchObject({ progress: 1, completed: false });
  });

  it('nhiều nhiệm vụ có mốc bắt đầu khác nhau: mỗi nguồn dữ liệu chỉ truy vấn một lần', async () => {
    const orderFind = jest.fn().mockResolvedValue([deliveredOrder('o1', 30)]);
    const reviewFind = jest.fn().mockResolvedValue([]);
    const ptsFind = jest.fn().mockResolvedValue([]);
    const coinFind = jest.fn().mockResolvedValue([]);
    const profileFind = jest.fn().mockResolvedValue({ streakDays: 1, lastCheckInAt: new Date() });
    const prisma = makePrisma({
      order: { findMany: orderFind },
      review: { findMany: reviewFind },
      pointsTransaction: { findMany: ptsFind },
      coinTransaction: { findMany: coinFind },
      gameProfile: { findUnique: profileFind },
      mission: {
        findMany: jest.fn().mockResolvedValue([
          custom({ id: 'a', code: 'A', startsAt: new Date(Date.now() - 1 * DAY_MS) }),
          custom({ id: 'b', code: 'B', startsAt: new Date(Date.now() - 2 * DAY_MS) }),
          custom({ id: 'c', code: 'C', kind: 'REVIEW_COUNT', startsAt: new Date(Date.now() - 3 * DAY_MS) }),
          custom({ id: 'd', code: 'D', kind: 'INVITE_COUNT', startsAt: new Date(Date.now() - 4 * DAY_MS) }),
          custom({ id: 'e', code: 'E', kind: 'CHECKIN_STREAK', startsAt: null }),
        ]),
      },
    });
    await svc(prisma).getMissions('u1');
    for (const f of [orderFind, reviewFind, ptsFind, coinFind, profileFind]) expect(f).toHaveBeenCalledTimes(1);
  });

  it('lượt mời chỉ đếm thưởng cấp từ mốc bắt đầu; thu hồi lượt cũ không trừ lượt mới', async () => {
    const day = (n: number) => new Date(Date.parse(NOW) + n * DAY_MS);
    const prisma = makePrisma({
      pointsTransaction: {
        findMany: jest.fn().mockResolvedValue([
          { reason: 'REFERRAL_ORDER2:old', createdAt: day(-10) },
          { reason: 'REFERRAL_ORDER2_REVOKE:old', createdAt: day(1) },
          { reason: 'REFERRAL_ORDER2:new', createdAt: day(2) },
        ]),
      },
      mission: { findMany: jest.fn().mockResolvedValue([custom({ kind: 'INVITE_COUNT', goal: 1 })]) },
    });
    jest.setSystemTime(day(3));
    expect((await svc(prisma).getMissions('u1'))[0]).toMatchObject({ progress: 1, completed: true });
  });

  it('lượt mời không có mốc dùng count, không đọc từng dòng thưởng; không có nhiệm vụ nào đang bật thì không đọc gì của khách', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const orderFind = jest.fn().mockResolvedValue([]);
    const profileFind = jest.fn().mockResolvedValue(null);
    const base = {
      pointsTransaction: { findMany: find, count },
      coinTransaction: { findMany: find, count },
      order: { findMany: orderFind },
      gameProfile: { findUnique: profileFind },
    };
    const none = makePrisma({ ...base, mission: { findMany: jest.fn().mockResolvedValue([]) } });
    expect(await svc(none).getMissions('u1')).toEqual([]);
    for (const f of [find, count, orderFind, profileFind]) expect(f).not.toHaveBeenCalled();

    const legacy = makePrisma({ ...base, mission: { findMany: jest.fn().mockResolvedValue([custom({ kind: 'INVITE_COUNT', startsAt: null })]) } });
    await svc(legacy).getMissions('u1');
    expect(find).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalled();

    count.mockClear();
    const dated = makePrisma({ ...base, mission: { findMany: jest.fn().mockResolvedValue([custom({ kind: 'INVITE_COUNT' })]) } });
    await svc(dated).getMissions('u1');
    expect(find).toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('nhiệm vụ cũ (startsAt rỗng) vẫn tính trọn đời, không lọc ngày', async () => {
    const reviewFind = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      review: { findMany: reviewFind },
      order: settledOrders(1),
      mission: { findMany: jest.fn().mockResolvedValue([custom({ code: 'FIRST_ORDER', kind: null, startsAt: null })]) },
    });
    expect((await svc(prisma).getMissions('u1'))[0]).toMatchObject({ progress: 1, completed: true });
    expect(reviewFind).toHaveBeenCalledTimes(1);
  });

  it('nhận thưởng khoá chia sẻ dòng nhiệm vụ và lấy điểm thưởng đọc trong giao dịch (quản trị vừa sửa điểm thì theo giá mới)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ pointsBalance: 100 }]);
    const startsAt = new Date(Date.now() - 60 * DAY_MS);
    const prisma = makePrisma({
      order: settledOrders(1),
      $queryRaw: queryRaw,
      mission: { findUnique: jest.fn().mockResolvedValueOnce(custom({ startsAt })).mockResolvedValue({ disabledAt: null, rewardPoints: 5_000 }) },
    });
    const r = await svc(prisma).claimMission('u1', 'CUSTOM_1');
    expect(r).toMatchObject({ claimed: true, rewardPoints: 5_000 });
    const sql = queryRaw.mock.calls.map((c) => (c[0] as TemplateStringsArray).join('?')).join('|');
    expect(sql).toMatch(/FROM "missions" WHERE "id" = \? FOR SHARE/);
  });

  it('bị tạm dừng ngay giữa lúc nhận (đọc lại trong giao dịch) → không cộng điểm', async () => {
    const pts = jest.fn();
    const prisma = makePrisma({
      order: settledOrders(1),
      mission: { findUnique: jest.fn().mockResolvedValueOnce(custom({ startsAt: new Date(Date.now() - 60 * DAY_MS) })).mockResolvedValue({ disabledAt: new Date() }) },
      pointsTransaction: { create: pts },
    });
    await expect(svc(prisma).claimMission('u1', 'CUSTOM_1')).rejects.toThrow('tạm dừng');
    expect(pts).not.toHaveBeenCalled();
  });
});
