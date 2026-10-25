import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { createUser, setConfig, summarize, warmPool } from './helpers';

/**
 * Cờ ecoImpact.sproutRewarded trên Postgres thật: guest thu hoạch cây mầm không nhận điểm, nâng cấp tài khoản thì nhận đúng
 * một lần dù nhiều lượt tưới song song; mã vòng quay (tiền tố GAME) không chiếm trần mã thu hoạch.
 */
describe('GameService.waterTree cờ sproutRewarded + trần mã thu hoạch (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, GameService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    game = moduleRef.get(GameService);
    await setConfig(prisma, 'game.tank_capacity', 5000);
    await setConfig(prisma, 'game.first_harvest_points', 2000);
    await setConfig(prisma, 'game.tree_target_ladder', [60, 300, 600]);
    await setConfig(prisma, 'game.harvest_coupon_daily_cap', 3);
    await setConfig(prisma, 'game.harvest_coupon_monthly_cap', 4);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const eco = (extra: Record<string, unknown> = {}) => ({
    progress: 0,
    target: 60,
    treeType: 'Cây Dứa Fuwa3e',
    treesPlanted: 0,
    ...extra,
  });

  it('guest thu hoạch cây mầm: không điểm, cờ false; nâng cấp lên khách thật rồi 6 lượt tưới song song → điểm cây mầm đúng 1 dòng, cờ true', async () => {
    const user = await createUser(prisma, { zaloId: `guest_${Math.random().toString(36).slice(2)}` });
    await prisma.gameProfile.create({ data: { userId: user.id, totalSeeds: 3000, ecoImpact: eco({ sproutRewarded: false }) } });
    await game.getProfile(user.id);

    const first = await game.waterTree(user.id, 60);
    expect(first.treesPlanted).toBe(1);
    expect(first.rewardBlocked).toBe('GUEST');
    expect(first.reward.points).toBeUndefined();
    expect(await prisma.pointsTransaction.count({ where: { userId: user.id, reason: 'GAME_FIRST_HARVEST' } })).toBe(0);

    await prisma.user.update({ where: { id: user.id }, data: { phone: `09${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}` } });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => game.waterTree(user.id, 300)));
    const s = summarize(results);

    const rows = await prisma.pointsTransaction.findMany({ where: { userId: user.id, reason: 'GAME_FIRST_HARVEST' } });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const profile = await prisma.gameProfile.findUniqueOrThrow({ where: { userId: user.id } });
    console.log('[sprout-flag] fulfilled=%d rejected=%d rows=%d errors=%j', s.fulfilled.length, s.rejected.length, rows.length, [...new Set(s.errors)]);

    expect(s.fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(rows).toHaveLength(1);
    expect(after.pointsBalance).toBe(2000);
    expect((profile.ecoImpact as { sproutRewarded: boolean }).sproutRewarded).toBe(true);
  });

  it('khách thật có 5 mã vòng quay GAME… trong tháng vẫn nhận mã thu hoạch HARVEST…', async () => {
    const user = await createUser(prisma, { zaloId: `zalo_${Math.random().toString(36).slice(2)}` });
    await prisma.gameProfile.create({
      data: { userId: user.id, totalSeeds: 1000, ecoImpact: eco({ target: 300, treesPlanted: 1, sproutRewarded: true }) },
    });
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      await prisma.coupon.create({
        data: {
          code: `GAME30000-${user.id.slice(-5)}-${i}${Math.floor(Math.random() * 1e6)}`.toUpperCase(),
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
    }
    await game.getProfile(user.id);
    const r = await game.waterTree(user.id, 300);
    expect(r.couponCapped).toBeUndefined();
    expect(r.reward.coupon).toMatch(/^HARVEST/);
    expect(r.reward.coupons).toEqual([r.reward.coupon]);
  });

  it('6 lượt tưới song song của khách thật với cờ chưa bật, đã có 1 cây: trần mã vẫn giữ (tối đa 3/ngày), điểm cây mầm 1 lần', async () => {
    const user = await createUser(prisma, { zaloId: `zalo_${Math.random().toString(36).slice(2)}` });
    await prisma.gameProfile.create({
      data: { userId: user.id, totalSeeds: 5000, ecoImpact: eco({ target: 300, treesPlanted: 1, sproutRewarded: false }) },
    });
    await game.getProfile(user.id);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => game.waterTree(user.id, 300)));
    const s = summarize(results);
    const harvestCoupons = await prisma.coupon.count({
      where: { code: { startsWith: 'HARVEST' }, scopeMeta: { path: ['userId'], equals: user.id } },
    });
    const rows = await prisma.pointsTransaction.count({ where: { userId: user.id, reason: 'GAME_FIRST_HARVEST' } });
    console.log('[sprout-cap] fulfilled=%d rejected=%d coupons=%d rows=%d errors=%j', s.fulfilled.length, s.rejected.length, harvestCoupons, rows, [...new Set(s.errors)]);
    expect(harvestCoupons).toBeLessThanOrEqual(3);
    expect(rows).toBe(1);
  });
});
