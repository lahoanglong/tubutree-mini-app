import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { GameEconomyService } from '../../src/modules/game/game-economy.service';
import type { SeasonPassService } from '../../src/modules/game/season-pass.service';
import { createUser, setConfig, summarize, warmPool } from './helpers';

/**
 * Nhịp chơi người mới trên Postgres thật: quà điểm danh lần đầu chỉ cộng một lần dù nhiều request cùng lúc, và điểm cây
 * mầm (thu hoạch đầu tiên) chỉ cộng một lần dù nhiều lượt tưới đồng thời.
 */
describe('GameEconomyService.checkIn quà lần đầu + GameService.waterTree cây mầm (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;
  let economy: GameEconomyService;

  const DAILY = 15;
  const FIRST = 50;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, GameService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    game = moduleRef.get(GameService);
    const seasonPass = { addXp: async () => undefined } as unknown as SeasonPassService;
    economy = new GameEconomyService(prisma, moduleRef.get(SystemConfigService), seasonPass, moduleRef.get(AnalyticsEventsService));

    // Config PHẢI có trước lần get() đầu (SystemConfigService cache 60s).
    await setConfig(prisma, 'game.daily_login_seeds', DAILY);
    await setConfig(prisma, 'game.first_checkin_bonus', FIRST);
    await setConfig(prisma, 'game.tank_capacity', 1000);
    await setConfig(prisma, 'game.first_harvest_points', 2000);
    await setConfig(prisma, 'game.tree_target_ladder', [60, 300, 600]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('10 request điểm danh đầu tiên song song của user mới → đúng 1 thành công, quà 50 cộng đúng 1 lần (tổng 65)', async () => {
    const user = await createUser(prisma);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => economy.checkIn(user.id)));
    const s = summarize(results);

    const profile = await prisma.gameProfile.findUniqueOrThrow({ where: { userId: user.id } });
    console.log('[first-checkin] fulfilled=%d rejected=%d totalSeeds=%d errors=%j', s.fulfilled.length, s.rejected.length, profile.totalSeeds, [...new Set(s.errors)]);

    expect(s.fulfilled).toHaveLength(1);
    expect(s.fulfilled[0]!.value.seedsEarned).toBe(DAILY + FIRST);
    expect(s.fulfilled[0]!.value.bonusNote).toContain(`+${FIRST}`);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    expect(profile.totalSeeds).toBe(DAILY + FIRST);
    expect(profile.streakDays).toBe(1);
  });

  it('điểm danh lần hai (ngày sau) không còn quà lần đầu', async () => {
    const user = await createUser(prisma);
    await economy.checkIn(user.id);
    await prisma.gameProfile.update({ where: { userId: user.id }, data: { lastCheckInAt: new Date(Date.now() - 24 * 3600 * 1000) } });
    const r = await economy.checkIn(user.id);
    expect(r.seedsEarned).toBe(DAILY);
    const profile = await prisma.gameProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profile.totalSeeds).toBe(DAILY + FIRST + DAILY);
  });

  it('6 lượt tưới 60💧 song song trên hồ sơ mới (cây đầu target 60) → điểm cây mầm cộng đúng 1 lần, không mã', async () => {
    const user = await createUser(prisma, { zaloId: `zalo_${Math.random().toString(36).slice(2)}` });
    await prisma.gameProfile.create({
      data: {
        userId: user.id,
        totalSeeds: 1000,
        ecoImpact: { progress: 0, target: 60, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 },
      },
    });
    // Mọi hàng cấu hình đọc trước khi tx mở; warm cache bằng một lần đọc hồ sơ.
    await game.getProfile(user.id);

    const results = await Promise.allSettled(Array.from({ length: 6 }, () => game.waterTree(user.id, 60)));
    const s = summarize(results);

    const sprout = await prisma.pointsTransaction.findMany({ where: { userId: user.id, reason: 'GAME_FIRST_HARVEST' } });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const profile = await prisma.gameProfile.findUniqueOrThrow({ where: { userId: user.id } });
    const coupons = await prisma.coupon.count({ where: { scopeMeta: { path: ['userId'], equals: user.id } } });
    console.log('[sprout] fulfilled=%d rejected=%d sproutRows=%d errors=%j', s.fulfilled.length, s.rejected.length, sprout.length, [...new Set(s.errors)]);

    expect(s.fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(sprout).toHaveLength(1);
    expect(sprout[0]!.delta).toBe(2000);
    expect(sprout[0]!.expiresAt).toBeInstanceOf(Date);
    expect(after.pointsBalance).toBe(2000);
    // nước trừ đúng số lượt thành công
    expect(profile.totalSeeds).toBe(1000 - 60 * s.fulfilled.length);
    // cây mầm không cấp mã; các cây sau (nếu có đủ nước dồn) mới có mã
    const treesPlanted = (profile.ecoImpact as { treesPlanted: number }).treesPlanted;
    expect(coupons).toBeLessThanOrEqual(Math.max(0, treesPlanted - 1));
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
  });
});
