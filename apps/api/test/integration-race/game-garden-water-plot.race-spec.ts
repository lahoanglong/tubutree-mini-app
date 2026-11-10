import { Test, type TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { GameGardenService } from '../../src/modules/game/game-garden.service';
import { createRealUser, createUser, setConfig, summarize, warmPool } from './helpers';

/**
 * Tưới lô phụ (`waterPlot`) chạy trong một transaction Serializable: đọc lô, trừ nước, đếm trần mã thu hoạch, cấp mã và ghi lô
 * cùng một lượt. Hai lệnh song song cùng đọc trạng thái cũ rồi cùng ghi giá trị tuyệt đối sẽ làm mất một lần tưới, nên bảo vệ ở
 * đây là Postgres huỷ một bên bằng P2034 (service đổi thành lỗi "Hệ thống đang bận"). Spec dùng Postgres thật vì `RaceDb` không
 * mô phỏng Serializable nên không chứng minh được đúng loại bảo vệ này.
 *
 * Lượt thua P2034 được phép (khách thử lại), nên mỗi ca khẳng định bất biến theo SỐ LƯỢT THẮNG: nước đã trừ, tiến độ lô, số cây và
 * số mã khớp đúng phần của các lượt thắng, không lượt nào bị mất hay đếm đôi. Lỗi nào ngoài "đang bận" và "không đủ nước" là lỗi thật.
 */
describe('GameGardenService.waterPlot song song (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let garden: GameGardenService;
  let game: GameService;

  const TARGET = 100;
  const DAILY_CAP = 2;
  const BUSY = 'Hệ thống đang bận, bạn thử tưới lại nhé.';
  const NO_WATER = 'Không đủ giọt nước.';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, GameService, GameGardenService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    garden = moduleRef.get(GameGardenService);
    game = moduleRef.get(GameService);
    await setConfig(prisma, 'game.tank_capacity', 100_000);
    await setConfig(prisma, 'game.harvest_coupon_daily_cap', DAILY_CAP);
    await setConfig(prisma, 'game.harvest_coupon_monthly_cap', 10);
    await setConfig(prisma, 'game.tree_target_ladder', [60, 60, 60, 60, 60, 60, 60, 60]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function setup(opts: { seeds: number; real?: boolean }) {
    const user = opts.real === false ? await createUser(prisma) : await createRealUser(prisma);
    await prisma.gameProfile.create({
      data: {
        userId: user.id,
        totalSeeds: opts.seeds,
        ecoImpact: { progress: 0, target: 60, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 1, sproutRewarded: true },
      },
    });
    const plot = await prisma.gardenPlot.create({
      data: { userId: user.id, slot: 1, treeType: 'Cây Dứa Fuwa3e', target: TARGET },
    });
    return { user, plot };
  }

  const seedsOf = async (userId: string) => (await prisma.gameProfile.findUniqueOrThrow({ where: { userId } })).totalSeeds;
  const plotOf = (id: string) => prisma.gardenPlot.findUniqueOrThrow({ where: { id } });
  const harvestCoupons = (userId: string) =>
    prisma.coupon.count({
      where: {
        scope: 'USER_GROUP',
        scopeMeta: { path: ['userId'], equals: userId },
        OR: [{ code: { startsWith: 'GARDEN' } }, { code: { startsWith: 'HARVEST' } }],
      },
    });
  const unexpected = (errors: string[]) => errors.filter((e) => !e.includes(BUSY) && !e.includes(NO_WATER));

  it('8 lượt tưới song song cùng lô (50💧 mỗi lượt): nước trừ đúng phần các lượt thắng, tiến độ lô không mất lượt nào, mỗi cây một chứng nhận', async () => {
    const { user, plot } = await setup({ seeds: 2000 });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => garden.waterPlot(user.id, plot.id, 50)));
    const s = summarize(results);
    expect(unexpected(s.errors)).toEqual([]);
    expect(s.fulfilled.length).toBeGreaterThanOrEqual(1);

    const won = s.fulfilled.length;
    const after = await plotOf(plot.id);
    expect(await seedsOf(user.id)).toBe(2000 - 50 * won);
    expect(after.progress + after.treesPlanted * TARGET).toBe(50 * won);
    const trees = await prisma.plantedTree.findMany({ where: { userId: user.id }, select: { certificateCode: true } });
    expect(trees).toHaveLength(after.treesPlanted);
    expect(new Set(trees.map((t) => t.certificateCode)).size).toBe(trees.length);
    expect(await harvestCoupons(user.id)).toBe(Math.min(after.treesPlanted, DAILY_CAP));
  });

  it('nước chỉ đủ 2 lượt (120💧, 4 lượt × 50💧 song song): tối đa 2 lượt thắng, nước không âm và khớp phần đã tưới', async () => {
    const { user, plot } = await setup({ seeds: 120 });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => garden.waterPlot(user.id, plot.id, 50)));
    const s = summarize(results);
    expect(unexpected(s.errors)).toEqual([]);
    const won = s.fulfilled.length;
    expect(won).toBeGreaterThanOrEqual(1);
    expect(won).toBeLessThanOrEqual(2);
    const left = await seedsOf(user.id);
    expect(left).toBe(120 - 50 * won);
    expect(left).toBeGreaterThanOrEqual(0);
    const after = await plotOf(plot.id);
    expect(after.progress + after.treesPlanted * TARGET).toBe(50 * won);
  });

  /** Khách thử lại khi gặp "đang bận" như Mini làm: mỗi worker tới khi thắng một lượt. */
  async function untilWon<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof Error) || !e.message.includes(BUSY)) throw e;
      }
    }
    throw new Error('vẫn bận sau 60 lần thử');
  }

  it('6 worker × 50💧 cùng lô, mỗi worker thử lại tới khi thắng: đủ 300💧 vào lô, đúng 3 cây, không mất lượt nào, nước trừ đúng 300', async () => {
    const { user, plot } = await setup({ seeds: 1000 });
    await Promise.all(Array.from({ length: 6 }, () => untilWon(() => garden.waterPlot(user.id, plot.id, 50))));
    const after = await plotOf(plot.id);
    expect(after.treesPlanted).toBe(3);
    expect(after.progress).toBe(0);
    expect(await seedsOf(user.id)).toBe(700);
    expect(await prisma.plantedTree.count({ where: { userId: user.id } })).toBe(3);
    expect(await harvestCoupons(user.id)).toBe(DAILY_CAP);
  });

  it('4 worker × 50💧 thử lại tới khi xong nhưng chỉ có 120💧: đúng 2 lượt thắng, 2 lượt bị từ chối vì thiếu nước, nước còn 20 (không âm), lô nhận đúng 100💧', async () => {
    const { user, plot } = await setup({ seeds: 120 });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => untilWon(() => garden.waterPlot(user.id, plot.id, 50))));
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(2);
    expect(s.rejected).toHaveLength(2);
    for (const e of s.errors) expect(e).toContain(NO_WATER);
    expect(await seedsOf(user.id)).toBe(20);
    const after = await plotOf(plot.id);
    expect(after.treesPlanted).toBe(1);
    expect(after.progress).toBe(0);
  });

  it('trần mã thu hoạch dùng chung lô nhà và lô phụ: đã có 1 mã HARVEST hôm nay (trần 2), lô nhà và lô phụ cùng thu hoạch → chỉ thêm 1 mã, bên còn lại báo couponCapped DAY', async () => {
    const { user, plot } = await setup({ seeds: 5000 });
    const now = new Date();
    await prisma.coupon.create({
      data: {
        code: `HARVEST30000-${user.id.slice(-5)}-${Math.floor(Math.random() * 1e6)}`.toUpperCase(),
        type: 'AMOUNT',
        value: 30000,
        minOrder: 199000,
        startAt: now,
        endAt: new Date(now.getTime() + 30 * 864e5),
        perUserLimit: 1,
        scope: 'USER_GROUP',
        scopeMeta: { userId: user.id },
      },
    });
    await game.getProfile(user.id);
    const [home, planted] = await Promise.all([
      untilWon(() => game.waterTree(user.id, 60)),
      untilWon(() => garden.waterPlot(user.id, plot.id, TARGET)),
    ]);
    expect(home.treesPlanted).toBe(2);
    expect(planted.harvested).toBe(true);
    expect(await harvestCoupons(user.id)).toBe(DAILY_CAP);
    const capped = [home.couponCapped, planted.couponCapped].filter((c) => c === 'DAY');
    expect(capped).toHaveLength(1);
  });

  it('khách vãng lai thu hoạch lô phụ: cây vẫn được ghi nhận nhưng không có mã, và báo rewardBlocked', async () => {
    const { user, plot } = await setup({ seeds: 500, real: false });
    const r = await garden.waterPlot(user.id, plot.id, TARGET);
    expect(r).toMatchObject({ harvested: true, treesPlanted: 1, rewardBlocked: 'GUEST' });
    expect(await prisma.plantedTree.count({ where: { userId: user.id } })).toBe(1);
    expect(await harvestCoupons(user.id)).toBe(0);
  });

  it('lô của người khác: 404 và nước không bị trừ, dù gọi song song nhiều lần', async () => {
    const { user: owner, plot } = await setup({ seeds: 500 });
    const { user: other } = await setup({ seeds: 500 });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => garden.waterPlot(other.id, plot.id, 50)));
    for (const r of results) {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(NotFoundException);
    }
    expect(await seedsOf(other.id)).toBe(500);
    expect(await seedsOf(owner.id)).toBe(500);
    expect((await plotOf(plot.id)).progress).toBe(0);
  });
});
