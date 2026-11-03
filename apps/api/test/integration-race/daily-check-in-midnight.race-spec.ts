import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameEconomyService } from '../../src/modules/game/game-economy.service';
import type { SeasonPassService } from '../../src/modules/game/season-pass.service';
import { DailyCheckInService } from '../../src/modules/daily-check-in/daily-check-in.service';
import { vnDateKey } from '../../src/common/vn-time';
import { createRealUser, setConfig, warmPool } from './helpers';

/**
 * VX2-07 và VX2-02 trên Postgres thật, đồng hồ giả chỉ cho Date (timer thật để pool Prisma chạy bình thường):
 * điểm danh gộp sát nửa đêm VN phải ghi cả hai phần vào cùng một ngày; điểm danh bằng vé giữ lửa không được làm mất cửa hồi sinh.
 */
describe('Điểm danh sát nửa đêm và hồi sinh chuỗi (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  let economy: GameEconomyService;

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
    await setConfig(prisma, 'game.daily_login_seeds', 15);
    await setConfig(prisma, 'game.first_checkin_bonus', 0);
    await setConfig(prisma, 'game.tank_capacity', 1000);
    await setConfig(prisma, 'game.streak_repair_cost', 150);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const fakeDateOnly = (iso: string) =>
    jest.useFakeTimers({ now: new Date(iso), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] });

  it('Điểm Xanh chạy trước 00:00, phần nước chạy sau 00:00: cùng ngày bấm, chuỗi 7 giữ nguyên, không mất vé, ngày kế nối tiếp', async () => {
    const user = await createRealUser(prisma, { pointsBalance: 0 });
    await prisma.gameProfile.create({
      data: { userId: user.id, totalSeeds: 0, streakDays: 6, streakFreezes: 1, lastCheckInAt: new Date('2030-06-14T12:00:00+07:00') },
    });
    fakeDateOnly('2030-06-15T23:59:59.900+07:00');
    const crossingLoyalty = {
      getDailyCheckInStatus: (id: string, now?: Date) => loyalty.getDailyCheckInStatus(id, now),
      dailyCheckIn: async (id: string, now?: Date) => {
        const r = await loyalty.dailyCheckIn(id, now);
        jest.setSystemTime(new Date('2030-06-16T00:00:00.500+07:00'));
        return r;
      },
    };
    const svc = new DailyCheckInService(prisma, moduleRef.get(SystemConfigService), crossingLoyalty as unknown as LoyaltyService, economy);

    const r = await svc.run(user.id);

    expect(r.pending).toEqual([]);
    expect(r.points).toMatchObject({ cycleDay: 7, streakDays: 7 });
    expect(r.water).toMatchObject({ streakDays: 7, streakFrozeUsed: false });
    const profile = await prisma.gameProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profile.streakDays).toBe(7);
    expect(profile.streakFreezes).toBe(1);
    expect(profile.brokenStreakDays).toBe(0);
    expect(vnDateKey(profile.lastCheckInAt!)).toBe('2030-06-15');
    const rows = await prisma.loyaltyCheckIn.findMany({ where: { userId: user.id } });
    expect(rows.map((x) => x.dayKey)).toEqual(['2030-06-15']);

    // Đồng hồ đã sang ngày 16: lượt bấm kế là ngày mới và nối tiếp chuỗi 7, không bị tính là lỡ ngày.
    const next = await svc.run(user.id);
    expect(next.pending).toEqual([]);
    expect(next.water).toMatchObject({ streakDays: 8, streakFrozeUsed: false });
    expect((await prisma.gameProfile.findUniqueOrThrow({ where: { userId: user.id } })).streakFreezes).toBe(1);
  });

  it('phần nước chạy trước 00:00, Điểm Xanh chạy sau 00:00: vẫn cùng ngày bấm', async () => {
    const user = await createRealUser(prisma, { pointsBalance: 0 });
    await prisma.gameProfile.create({
      data: { userId: user.id, totalSeeds: 0, streakDays: 6, streakFreezes: 1, lastCheckInAt: new Date('2030-07-14T12:00:00+07:00') },
    });
    fakeDateOnly('2030-07-15T23:59:59.900+07:00');
    const crossingEconomy = {
      checkIn: async (id: string, now?: Date) => {
        const r = await economy.checkIn(id, now);
        jest.setSystemTime(new Date('2030-07-16T00:00:00.500+07:00'));
        return r;
      },
    };
    const svc = new DailyCheckInService(prisma, moduleRef.get(SystemConfigService), loyalty, crossingEconomy as unknown as GameEconomyService);

    const r = await svc.run(user.id);

    expect(r.pending).toEqual([]);
    const rows = await prisma.loyaltyCheckIn.findMany({ where: { userId: user.id } });
    expect(rows.map((x) => x.dayKey)).toEqual(['2030-07-15']);
    expect(rows[0]!.cycleDay).toBe(7);
  });

  it('lỡ chuỗi dài, còn vé: điểm danh trước rồi hồi sinh sau vẫn hồi sinh được chuỗi dài (không phụ thuộc thứ tự bấm)', async () => {
    const user = await createRealUser(prisma, { pointsBalance: 0 });
    await prisma.gameProfile.create({
      data: {
        userId: user.id,
        totalSeeds: 500,
        streakDays: 1,
        streakFreezes: 1,
        lastCheckInAt: new Date('2030-08-13T12:00:00+07:00'),
        brokenStreakDays: 10,
        brokenStreakAt: new Date('2030-08-13T12:00:00+07:00'),
      },
    });
    fakeDateOnly('2030-08-15T12:00:00+07:00');

    const checked = await economy.checkIn(user.id);
    expect(checked).toMatchObject({ streakDays: 2, streakFrozeUsed: true });
    const repaired = await economy.repairStreak(user.id);

    expect(repaired).toMatchObject({ repaired: true, streakDays: 11 });
    const profile = await prisma.gameProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profile.streakDays).toBe(11);
    expect(profile.totalSeeds).toBe(500 + 15 - 150);
  });
});
