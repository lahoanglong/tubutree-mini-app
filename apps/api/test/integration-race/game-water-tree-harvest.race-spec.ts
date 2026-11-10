import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameCommunityService } from '../../src/modules/game/game-community.service';
import { GameService } from '../../src/modules/game/game.service';
import { createUser, deleteItData, pinConfig, sleep, summarize, warmPool } from './helpers';

/**
 * Tưới cây chính (`GameService.waterTree`) song song trên Postgres thật. Giao dịch Serializable nên một số lượt bị P2034 và báo
 * "Hệ thống đang bận"; lượt thắng phải bảo toàn: nước trừ đúng tổng các lượt thắng, tiến độ + số cây khớp tổng nước đã tưới, mỗi
 * cây thu hoạch đúng một chứng nhận, mã thu hoạch không vượt trần ngày, hồ cộng đồng nhận đúng phần nước đã nuôi cây.
 */
describe('GameService.waterTree song song: bảo toàn nước, trần mã thu hoạch, hồ cộng đồng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;
  const userIds: string[] = [];
  const goalIds: string[] = [];
  const restoreConfig: Array<() => Promise<void>> = [];
  let seq = 0;
  const TARGET = 100;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, GameCommunityService, GameService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    game = moduleRef.get(GameService);
    restoreConfig.push(
      await pinConfig(prisma, 'game.tank_capacity', 5000),
      await pinConfig(prisma, 'game.first_harvest_points', 0),
      await pinConfig(prisma, 'game.tree_target_ladder', [60, TARGET]),
      await pinConfig(prisma, 'game.harvest_coupon_daily_cap', 3),
      await pinConfig(prisma, 'game.harvest_coupon_monthly_cap', 10),
    );
  });

  afterEach(async () => {
    await prisma.communityGoal.deleteMany({ where: { id: { in: goalIds.splice(0) } } });
    const ids = userIds.splice(0);
    for (const id of ids) await prisma.coupon.deleteMany({ where: { scopeMeta: { path: ['userId'], equals: id } } });
    await deleteItData(prisma, { userIds: ids });
  });

  afterAll(async () => {
    for (const restore of restoreConfig.splice(0).reverse()) await restore();
    await moduleRef?.close();
  });

  async function goal() {
    const g = await prisma.communityGoal.create({
      data: { title: 'IT hồ cây', region: 'IT', targetDrops: 10_000_000, treesToPlant: 1, startAt: new Date(1000 + seq++) },
    });
    goalIds.push(g.id);
    return g;
  }

  async function farmer(water: number, progress: number) {
    const user = await createUser(prisma, { zaloId: `zalo_${Math.random().toString(36).slice(2)}` });
    userIds.push(user.id);
    await prisma.gameProfile.create({
      data: { userId: user.id, totalSeeds: water, ecoImpact: { progress, target: TARGET, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 1, sproutRewarded: true } },
    });
    return user;
  }

  /** Thử lại khi bị P2034 ("Hệ thống đang bận"); lỗi khác ném ra ngay để test thấy. */
  async function waterUntilDone(userId: string, drops: number) {
    for (let i = 0; i < 60; i++) {
      try {
        return await game.waterTree(userId, drops);
      } catch (e) {
        if (!/đang bận/.test((e as Error).message)) throw e;
        await sleep(5 + Math.floor(Math.random() * 25));
      }
    }
    throw new Error('waterTree vẫn bận sau 60 lần thử');
  }

  async function state(userId: string) {
    const profile = await prisma.gameProfile.findUniqueOrThrow({ where: { userId } });
    const eco = profile.ecoImpact as { progress: number; target: number; treesPlanted: number };
    const trees = await prisma.plantedTree.count({ where: { userId } });
    const coupons = await prisma.coupon.count({ where: { scopeMeta: { path: ['userId'], equals: userId }, code: { startsWith: 'HARVEST' } } });
    return { water: profile.totalSeeds, eco, trees, coupons };
  }

  it('8 lượt 50💧 song song (ai thắng thì thắng): nước trừ đúng tổng lượt thắng, tiến độ + cây khớp tổng nước, mỗi cây một chứng nhận', async () => {
    const g = await goal();
    const user = await farmer(1000, 30);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => game.waterTree(user.id, 50)));
    const s = summarize(results);
    const won = s.fulfilled.length;
    const st = await state(user.id);
    console.log('[water-tree] won=%d rejected=%d errors=%j', won, s.rejected.length, [...new Set(s.errors)]);

    expect(won).toBeGreaterThanOrEqual(1);
    for (const e of s.errors) expect(e).toMatch(/đang bận/);
    expect(st.water).toBe(1000 - 50 * won);
    const newTrees = st.eco.treesPlanted - 1;
    expect(30 + 50 * won).toBe(TARGET * newTrees + st.eco.progress);
    expect(st.eco.progress).toBeLessThan(TARGET);
    expect(st.trees).toBe(newTrees);
    expect(st.coupons).toBe(Math.min(newTrees, 3));

    const harvestedDrops = TARGET * newTrees;
    const pool = (await prisma.communityGoal.findUniqueOrThrow({ where: { id: g.id } })).currentDrops;
    expect(pool).toBe(harvestedDrops);
  });

  it('6 worker × 50💧 thử lại tới khi thắng: đủ 300💧 vào cây, đúng 3 cây, 3 mã, nước trừ đúng 300, hồ nhận đúng 300', async () => {
    const g = await goal();
    const user = await farmer(1000, 0);
    const results = await Promise.all(Array.from({ length: 6 }, () => waterUntilDone(user.id, 50)));
    const st = await state(user.id);

    expect(results).toHaveLength(6);
    expect(st.water).toBe(700);
    expect(st.eco.treesPlanted).toBe(1 + 3);
    expect(st.eco.progress).toBe(0);
    expect(st.trees).toBe(3);
    expect(st.coupons).toBe(3);
    expect(results.filter((r) => r.harvested)).toHaveLength(3);
    expect((await prisma.communityGoal.findUniqueOrThrow({ where: { id: g.id } })).currentDrops).toBe(300);
    const row = await prisma.communityContribution.findMany({ where: { goalId: g.id, userId: user.id } });
    expect(row).toHaveLength(1);
    expect(row[0].drops).toBe(300);
  });

  it('trần mã ngày 3: 6 lượt 100💧 (mỗi lượt một cây) thử lại tới khi thắng → 6 cây, 6 chứng nhận, đúng 3 mã, các lượt sau báo couponCapped DAY', async () => {
    await goal();
    const user = await farmer(1000, 0);
    const results = await Promise.all(Array.from({ length: 6 }, () => waterUntilDone(user.id, TARGET)));
    const st = await state(user.id);

    expect(st.water).toBe(400);
    expect(st.trees).toBe(6);
    expect(st.eco.treesPlanted).toBe(1 + 6);
    expect(st.coupons).toBe(3);
    expect(results.filter((r) => r.reward.coupon)).toHaveLength(3);
    expect(results.filter((r) => r.couponCapped === 'DAY')).toHaveLength(3);
  });

  it('nước chỉ đủ 2 lượt (120💧, 4 worker × 50💧): đúng 2 lượt thắng, 2 lượt bị từ chối vì thiếu nước, nước còn 20, tiến độ khớp', async () => {
    await goal();
    const user = await farmer(120, 0);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => waterUntilDone(user.id, 50)));
    const s = summarize(results);
    const st = await state(user.id);

    expect(s.fulfilled).toHaveLength(2);
    expect(s.rejected).toHaveLength(2);
    for (const e of s.errors) expect(e).toMatch(/Không đủ giọt nước/);
    expect(st.water).toBe(20);
    expect(st.eco.treesPlanted).toBe(2);
    expect(st.eco.progress).toBe(0);
    expect(st.trees).toBe(1);
  });

  it('hồ sơ cũ đã đủ nước (progress = target), 5 lượt thu hoạch drops=0 song song: đúng 1 cây và 1 mã, các lượt kia báo cây chưa đủ nước', async () => {
    const g = await goal();
    const user = await farmer(0, TARGET);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => game.waterTree(user.id, 0)));
    const s = summarize(results);
    const st = await state(user.id);

    expect(s.fulfilled).toHaveLength(1);
    expect(st.eco.treesPlanted).toBe(2);
    expect(st.eco.progress).toBe(0);
    expect(st.trees).toBe(1);
    expect(st.coupons).toBe(1);
    for (const e of s.errors) expect(e).toMatch(/Cây chưa đủ nước|đang bận/);
    expect((await prisma.communityGoal.findUniqueOrThrow({ where: { id: g.id } })).currentDrops).toBe(TARGET);

    // Các lượt song song có thể bị Serializable chặn trước khi tới guard; lượt tuần tự sau đó mới thấy guard "chưa đủ nước".
    await expect(game.waterTree(user.id, 0)).rejects.toThrow(/Cây chưa đủ nước/);
    expect((await state(user.id)).trees).toBe(1);
  });
});
