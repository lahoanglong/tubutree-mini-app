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
});
