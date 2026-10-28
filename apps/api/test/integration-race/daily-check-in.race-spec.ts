import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameEconomyService } from '../../src/modules/game/game-economy.service';
import type { SeasonPassService } from '../../src/modules/game/season-pass.service';
import { DailyCheckInService } from '../../src/modules/daily-check-in/daily-check-in.service';
import { createUser, setConfig, warmPool } from './helpers';

/**
 * Điểm danh gộp trên Postgres thật: nhiều lời gọi đồng thời cùng ngày chỉ cộng Điểm Xanh một lần và giọt nước một lần;
 * bên đã điểm danh từ trước thì lời gọi gộp chỉ cộng bên còn lại.
 */
describe('DailyCheckInService race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  let economy: GameEconomyService;
  let svc: DailyCheckInService;

  const DAILY_WATER = 15;
  const FIRST_BONUS = 0;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const config = moduleRef.get(SystemConfigService);
    loyalty = moduleRef.get(LoyaltyService);
    const seasonPass = { addXp: async () => undefined } as unknown as SeasonPassService;
    economy = new GameEconomyService(prisma, config, seasonPass, moduleRef.get(AnalyticsEventsService));
    svc = new DailyCheckInService(prisma, config, loyalty, economy);

    // Config PHẢI có trước lần get() đầu (SystemConfigService cache 60s).
    await setConfig(prisma, 'game.daily_login_seeds', DAILY_WATER);
    await setConfig(prisma, 'game.first_checkin_bonus', FIRST_BONUS);
    await setConfig(prisma, 'game.tank_capacity', 1000);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function tally(userId: string) {
    const [pointsRows, user, profile] = await Promise.all([
      prisma.pointsTransaction.findMany({ where: { userId, refType: 'CHECKIN' } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.gameProfile.findUnique({ where: { userId } }),
    ]);
    return { pointsRows, balance: user.pointsBalance, seeds: profile?.totalSeeds ?? 0 };
  }

  it.each([2, 5])('%d lời gọi gộp đồng thời cùng user cùng ngày: Điểm Xanh +1 lần, giọt nước +1 lần, không lời gọi nào lỗi', async (n) => {
    const user = await createUser(prisma, { pointsBalance: 0 });
    const results = await Promise.allSettled(Array.from({ length: n }, () => svc.run(user.id)));
    const t = await tally(user.id);
    console.log('[daily-check-in] n=%d results=%j rows=%d balance=%d seeds=%d', n, results.map((r) => r.status), t.pointsRows.length, t.balance, t.seeds);

    for (const r of results) expect(r.status).toBe('fulfilled');
    const ok = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof svc.run>>>).value);
    expect(ok.filter((r) => r.points !== null)).toHaveLength(1);
    expect(ok.filter((r) => r.water !== null)).toHaveLength(1);
    expect(t.pointsRows).toHaveLength(1);
    expect(t.balance).toBe(t.pointsRows[0]!.delta);
    expect(t.seeds).toBe(DAILY_WATER);
    // Lời gọi chỉ thua race ở cả hai phần thì báo đã xong, không có phần nào còn thiếu.
    for (const r of ok) expect(r.pending).toEqual([]);
  });

  it('đã điểm danh Điểm Xanh từ trước: lời gọi gộp chỉ cộng giọt nước, và ngược lại', async () => {
    const a = await createUser(prisma, { pointsBalance: 0 });
    await loyalty.dailyCheckIn(a.id);
    const before = await tally(a.id);
    const ra = await svc.run(a.id);
    const afterA = await tally(a.id);
    expect(ra.points).toBeNull();
    expect(ra.water).not.toBeNull();
    expect(ra.alreadyDone).toBe(false);
    expect(afterA.balance).toBe(before.balance);
    expect(afterA.pointsRows).toHaveLength(1);
    expect(afterA.seeds).toBe(DAILY_WATER);

    const b = await createUser(prisma, { pointsBalance: 0 });
    await economy.checkIn(b.id);
    const rb = await svc.run(b.id);
    const afterB = await tally(b.id);
    expect(rb.water).toBeNull();
    expect(rb.points).not.toBeNull();
    expect(afterB.seeds).toBe(DAILY_WATER);
    expect(afterB.pointsRows).toHaveLength(1);
  });

  it('gọi lần hai trong ngày: alreadyDone, không cộng thêm gì', async () => {
    const user = await createUser(prisma, { pointsBalance: 0 });
    await svc.run(user.id);
    const before = await tally(user.id);
    const again = await svc.run(user.id);
    const after = await tally(user.id);
    expect(again).toMatchObject({ points: null, water: null, alreadyDone: true, pending: [] });
    expect(after).toEqual(before);
    expect((await svc.status(user.id)).checkedInToday).toBe(true);
  });

  describe('MỘT chuỗi chung: ngày của Điểm Xanh = ngày của chuỗi nước', () => {
    const DAYMS = 864e5;
    // Bảng điểm mặc định (SystemConfigService cache cấu hình nên không đổi giữa các ca): ngày 1..6 = 1.000, ngày 7 = 2.000.

    const seedStreak = (userId: string, daysAgo: number, streakDays: number, streakFreezes = 0) =>
      prisma.gameProfile.upsert({
        where: { userId },
        create: { userId, lastCheckInAt: new Date(Date.now() - daysAgo * DAYMS), streakDays, streakFreezes, totalSeeds: 0 },
        update: { lastCheckInAt: new Date(Date.now() - daysAgo * DAYMS), streakDays, streakFreezes, totalSeeds: 0 },
      });

    it('hôm qua chuỗi 2 → hôm nay ngày 3: Điểm Xanh theo ngày 3, nước gồm +5 chuỗi 3 ngày; status hứa đúng số sẽ nhận', async () => {
      const user = await createUser(prisma, { pointsBalance: 0 });
      await seedStreak(user.id, 1, 2);
      const before = await svc.status(user.id);
      expect(before).toMatchObject({ currentCycleDay: 3, streakDay: 3, streakDays: 2, todayPoints: 1000, todayWater: DAILY_WATER + 5 });
      const r = await svc.run(user.id);
      expect(r.points).toMatchObject({ cycleDay: 3, streakDays: 3, pointsEarned: 1000 });
      expect(r.water).toMatchObject({ streakDays: 3, seedsEarned: DAILY_WATER + 5 });
      const after = await svc.status(user.id);
      expect(after).toMatchObject({ checkedInToday: true, currentCycleDay: 3, streakDays: 3 });
    });

    it('5 lời gọi song song cùng ngày: một dòng điểm theo ngày của chuỗi nước, một lần cộng nước', async () => {
      const user = await createUser(prisma, { pointsBalance: 0 });
      await seedStreak(user.id, 1, 5);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => svc.run(user.id)));
      for (const r of results) expect(r.status).toBe('fulfilled');
      const t = await tally(user.id);
      expect(t.pointsRows).toHaveLength(1);
      expect(t.pointsRows[0]!.delta).toBe(1000);
      expect(t.pointsRows[0]!.reason).toBe('DAILY_CHECKIN:DAY_6');
      expect(t.seeds).toBe(DAILY_WATER + 5); // ngày 6 của chuỗi là mốc 3 ngày
      const profile = await prisma.gameProfile.findUniqueOrThrow({ where: { userId: user.id } });
      expect(profile.streakDays).toBe(6);
    });

    it('lỡ đúng 1 ngày có vé giữ lửa: chuỗi chung được giữ cho cả hai, vé trừ một', async () => {
      const user = await createUser(prisma, { pointsBalance: 0 });
      await seedStreak(user.id, 2, 3, 1);
      const r = await svc.run(user.id);
      expect(r.water).toMatchObject({ streakDays: 4, streakFrozeUsed: true });
      expect(r.points).toMatchObject({ cycleDay: 4, streakDays: 4, pointsEarned: 1000 });
      const profile = await prisma.gameProfile.findUniqueOrThrow({ where: { userId: user.id } });
      expect(profile.streakFreezes).toBe(0);
    });

    it('lỡ ngày không có vé: cả hai về ngày 1', async () => {
      const user = await createUser(prisma, { pointsBalance: 0 });
      await seedStreak(user.id, 2, 6, 0);
      const r = await svc.run(user.id);
      expect(r.water).toMatchObject({ streakDays: 1 });
      expect(r.points).toMatchObject({ cycleDay: 1, pointsEarned: 1000 });
    });

    it('chuỗi 7 rồi sang vòng mới: ngày 7 nhận 2.000 + thưởng mốc nước, hôm sau là ngày 1', async () => {
      const user = await createUser(prisma, { pointsBalance: 0 });
      await seedStreak(user.id, 1, 6);
      const d7 = await svc.run(user.id);
      expect(d7.points).toMatchObject({ cycleDay: 7, pointsEarned: 2000 });
      expect(d7.water!.seedsEarned).toBeGreaterThan(DAILY_WATER);
      // Dời "hôm nay" thành hôm qua để mô phỏng ngày kế tiếp.
      await prisma.gameProfile.update({ where: { userId: user.id }, data: { lastCheckInAt: new Date(Date.now() - DAYMS) } });
      await prisma.loyaltyCheckIn.deleteMany({ where: { userId: user.id } });
      await prisma.pointsTransaction.deleteMany({ where: { userId: user.id, refType: 'CHECKIN' } });
      const d8 = await svc.run(user.id);
      expect(d8.points).toMatchObject({ cycleDay: 1, streakDays: 8, pointsEarned: 1000 });
    });

    it('ngày chuyển đổi: Điểm Xanh đã nhận hôm nay theo chuỗi cũ, nước chưa → chỉ cộng nước, không nhận Điểm Xanh lần hai', async () => {
      const user = await createUser(prisma, { pointsBalance: 0 });
      await seedStreak(user.id, 1, 1);
      // Dòng điểm danh Điểm Xanh của chuỗi cũ (đang ở ngày 5) đã nhận hôm nay.
      await prisma.loyaltyCheckIn.create({ data: { userId: user.id, dayKey: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), cycleDay: 5, streakDays: 5, points: 5000 } });
      const r = await svc.run(user.id);
      expect(r.points).toBeNull();
      expect(r.water).toMatchObject({ streakDays: 2 });
      const status = await svc.status(user.id);
      expect(status).toMatchObject({ checkedInToday: true, currentCycleDay: 2 });
      const t = await tally(user.id);
      expect(t.pointsRows).toHaveLength(0);
    });
  });
});
