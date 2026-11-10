import { Prisma } from '@prisma/client';
import { DailyCheckInService } from './daily-check-in.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { GameEconomyService } from '../game/game-economy.service';
import { vnDateKey } from '../../common/vn-time';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { SeasonPassService } from '../game/season-pass.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

/**
 * Cùng một lời bấm "Điểm danh" tới hai lần song song (đúp chạm, retry mạng) qua ĐƯỜNG THẬT: DailyCheckInService.run gọi
 * LoyaltyService.dailyCheckIn và GameEconomyService.checkIn trên cùng một DB giả. DB giả giữ đúng những bảo đảm Postgres mà
 * code dựa vào: mỗi thao tác nhường event-loop (hai lượt XEN KẼ như thật, kể cả bước kiểm "đã xong chưa" ngoài tx),
 * unique (loyalty_check_ins userId+dayKey, ledger CHECKIN userId+refId, game_profiles userId) ném P2002, và updateMany có
 * điều kiện WHERE là MỘT câu lệnh nguyên tử. Race thật trên Postgres: test/integration-race/daily-check-in.race-spec.ts.
 */
const tick = () => new Promise<void>((r) => setImmediate(r));
const p2002 = (target: string) =>
  new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${target}`, { code: 'P2002', clientVersion: 'test', meta: { target } });

type Row = Record<string, any>;
const DAY = 864e5;

function applyData(target: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) target[k] += v.increment;
    else if (v && typeof v === 'object' && !(v instanceof Date) && 'decrement' in v) target[k] -= v.decrement;
    else target[k] = v;
  }
}

/** Điều kiện WHERE của economy.tryCheckIn: lastCheckInAt (null hoặc trước hôm nay) + streakDays/streakFreezes/brokenStreakAt khớp lần đọc. */
function matchesCheckInWhere(p: Row, where: Row): boolean {
  const or = where.OR as { lastCheckInAt: null | { lt: Date } }[] | undefined;
  if (or && !or.some((c) => (c.lastCheckInAt === null ? p.lastCheckInAt === null : p.lastCheckInAt !== null && p.lastCheckInAt < c.lastCheckInAt.lt))) return false;
  for (const k of ['streakDays', 'streakFreezes']) if (k in where && where[k] !== p[k]) return false;
  if ('brokenStreakAt' in where) {
    const want = where.brokenStreakAt as Date | null;
    const have = p.brokenStreakAt as Date | null;
    if ((want === null) !== (have === null)) return false;
    if (want && have && want.getTime() !== have.getTime()) return false;
  }
  return true;
}

function makeWorld(init: { profile?: Row | null; checkedInPointsToday?: boolean; balance?: number } = {}) {
  const today = vnDateKey(new Date());
  const db = {
    user: { id: 'u1', pointsBalance: init.balance ?? 0, phone: null as string | null, zaloId: 'zalo-u1' } as Row,
    checkIns: (init.checkedInPointsToday ? [{ id: 'ci-0', userId: 'u1', dayKey: today, cycleDay: 1, streakDays: 1, points: 1000 }] : []) as Row[],
    ledger: (init.checkedInPointsToday ? [{ id: 'ptx-0', userId: 'u1', delta: 1000, reason: 'DAILY_CHECKIN:DAY_1', refType: 'CHECKIN', refId: today }] : []) as Row[],
    profile: (init.profile ? { ...init.profile } : null) as Row | null,
  };
  let seq = 0;
  const client = {
    user: {
      findUnique: async () => {
        await tick();
        return { ...db.user };
      },
      findUniqueOrThrow: async () => {
        await tick();
        return { ...db.user };
      },
      update: async ({ data }: Row) => {
        await tick();
        applyData(db.user, data);
        return { ...db.user };
      },
    },
    loyaltyCheckIn: {
      findFirst: async ({ where }: Row) => {
        await tick();
        return db.checkIns.find((r) => r.userId === where.userId && r.dayKey === where.dayKey) ?? null;
      },
      create: async ({ data }: Row) => {
        await tick();
        if (db.checkIns.some((r) => r.userId === data.userId && r.dayKey === data.dayKey)) throw p2002('loyalty_check_ins_userId_dayKey_key');
        const row = { id: `ci-${++seq}`, ...data };
        db.checkIns.push(row);
        return { ...row };
      },
    },
    pointsTransaction: {
      create: async ({ data }: Row) => {
        await tick();
        if (data.refType === 'CHECKIN' && db.ledger.some((r) => r.refType === 'CHECKIN' && r.userId === data.userId && r.refId === data.refId)) {
          throw p2002('points_transactions_checkin_day_key');
        }
        const row = { id: `ptx-${++seq}`, ...data };
        db.ledger.push(row);
        return { ...row };
      },
    },
    gameProfile: {
      findUnique: async () => {
        await tick();
        return db.profile ? { ...db.profile } : null;
      },
      findUniqueOrThrow: async () => {
        await tick();
        if (!db.profile) throw new Error('game_profiles not found');
        return { ...db.profile };
      },
      create: async ({ data }: Row) => {
        await tick();
        if (db.profile) throw p2002('game_profiles_userId_key');
        db.profile = {
          totalSeeds: 0, streakDays: 0, longestStreak: 0, streakFreezes: 0, lastCheckInAt: null, lastDewAt: null,
          brokenStreakDays: 0, brokenStreakAt: null, lastStreakRepairAt: null, treeStage: 1, ...data,
        };
        return { ...db.profile };
      },
      updateMany: async ({ where, data }: Row) => {
        await tick();
        if (!db.profile || !matchesCheckInWhere(db.profile, where)) return { count: 0 };
        applyData(db.profile, data);
        return { count: 1 };
      },
    },
    // clampTankKeepingOverflow: bình mặc định 500 > mọi lượt cộng trong test nên không cần cắt.
    $executeRaw: async () => 1,
  };
  const prisma = { ...client, $transaction: async (fn: (tx: typeof client) => unknown) => fn(client) } as unknown as PrismaService;
  const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
  const seasonPass = { addXp: jest.fn().mockResolvedValue(undefined) };
  const analytics = { record: jest.fn().mockResolvedValue(undefined), recordBestEffort: jest.fn().mockResolvedValue(undefined) };
  const loyalty = new LoyaltyService(prisma, config);
  const economy = new GameEconomyService(prisma, config, seasonPass as unknown as SeasonPassService, analytics as unknown as AnalyticsEventsService);
  const svc = new DailyCheckInService(prisma, config, loyalty, economy);
  return { db, svc, seasonPass, prisma };
}

const yesterdayProfile = (streakDays: number, totalSeeds = 0): Row => ({
  totalSeeds, streakDays, longestStreak: streakDays, streakFreezes: 0, lastCheckInAt: new Date(Date.now() - DAY),
  lastDewAt: null, brokenStreakDays: 0, brokenStreakAt: null, lastStreakRepairAt: null, treeStage: 1, ecoImpact: {},
});

type Result = Awaited<ReturnType<DailyCheckInService['run']>>;

/** Mỗi phần được cộng đúng một lần trên toàn bộ các lời gọi; không lời gọi nào ném lỗi hay báo thiếu phần. */
function expectOneGrantPerHalf(results: Result[], { points, water }: { points: boolean; water: boolean }) {
  expect(results.filter((r) => r.points !== null)).toHaveLength(points ? 1 : 0);
  expect(results.filter((r) => r.water !== null)).toHaveLength(water ? 1 : 0);
  for (const r of results) expect(r.pending).toEqual([]);
  // Lời gọi không cộng gì (cả hai phần đã xong bởi lời gọi khác) là kết quả "đã điểm danh" giống lần bấm lại tuần tự.
  for (const r of results) expect(r.alreadyDone).toBe(r.points === null && r.water === null);
}

describe('fake DB (tự kiểm)', () => {
  it('bắt được race check-rồi-cộng kiểu ngây thơ: các lời gọi song song cùng thấy "chưa điểm danh" rồi cùng cộng điểm', async () => {
    const { db, prisma } = makeWorld();
    const today = vnDateKey(new Date());
    const naive = async () => {
      const done = await prisma.loyaltyCheckIn.findFirst({ where: { userId: 'u1', dayKey: today } });
      if (done) return;
      await prisma.user.update({ where: { id: 'u1' }, data: { pointsBalance: { increment: 1000 } } });
    };
    await Promise.all(Array.from({ length: 5 }, naive));
    expect(db.user.pointsBalance).toBeGreaterThan(1000);
  });
});

describe('DailyCheckInService.run: cùng một lời bấm tới song song (Điểm Xanh + giọt nước, đường thật)', () => {
  it('lần điểm danh đầu tiên, 8 lời gọi song song: mỗi phần cộng đúng một lần, bằng đúng một lần bấm tuần tự', async () => {
    const seq = makeWorld();
    await seq.svc.run('u1');
    expect(seq.db.user.pointsBalance).toBeGreaterThan(0);
    expect(seq.db.profile!.totalSeeds).toBeGreaterThan(0);

    const par = makeWorld();
    const results = await Promise.all(Array.from({ length: 8 }, () => par.svc.run('u1')));

    expectOneGrantPerHalf(results, { points: true, water: true });
    expect(par.db.user.pointsBalance).toBe(seq.db.user.pointsBalance);
    expect(par.db.ledger).toHaveLength(1);
    expect(par.db.checkIns).toHaveLength(1);
    expect(par.db.profile!.totalSeeds).toBe(seq.db.profile!.totalSeeds);
    expect(par.db.profile!.streakDays).toBe(1);
    expect(par.seasonPass.addXp).toHaveBeenCalledTimes(1);
  });

  it('đang giữ chuỗi (hôm qua chuỗi 2 → hôm nay ngày 3), 6 lời gọi song song: chuỗi chỉ tăng một nấc, mỗi phần cộng một lần', async () => {
    const seq = makeWorld({ profile: yesterdayProfile(2), balance: 500 });
    await seq.svc.run('u1');

    const par = makeWorld({ profile: yesterdayProfile(2), balance: 500 });
    const results = await Promise.all(Array.from({ length: 6 }, () => par.svc.run('u1')));

    expectOneGrantPerHalf(results, { points: true, water: true });
    expect(par.db.profile!.streakDays).toBe(3);
    expect(par.db.profile!.totalSeeds).toBe(seq.db.profile!.totalSeeds);
    expect(par.db.user.pointsBalance).toBe(seq.db.user.pointsBalance);
    expect(par.db.ledger).toHaveLength(1);
    expect(par.seasonPass.addXp).toHaveBeenCalledTimes(1);
  });

  it('chuỗi 1 lỡ nhiều ngày (reset về 1 nên streakDays/streakFreezes/brokenStreakAt không đổi sau lượt thắng): điều kiện lastCheckInAt là chốt chặn duy nhất của nước', async () => {
    const lapsed = { ...yesterdayProfile(1), lastCheckInAt: new Date(Date.now() - 5 * DAY) };
    const seq = makeWorld({ profile: lapsed });
    await seq.svc.run('u1');

    const par = makeWorld({ profile: lapsed });
    const results = await Promise.all(Array.from({ length: 6 }, () => par.svc.run('u1')));

    expectOneGrantPerHalf(results, { points: true, water: true });
    expect(par.db.profile!.streakDays).toBe(1);
    expect(par.db.profile!.totalSeeds).toBeGreaterThan(0);
    expect(par.db.profile!.totalSeeds).toBe(seq.db.profile!.totalSeeds);
    expect(par.seasonPass.addXp).toHaveBeenCalledTimes(1);
  });

  it('Điểm Xanh đã xong từ trước, giọt nước chưa: 5 lời gọi song song chỉ cộng nước một lần, KHÔNG thêm dòng điểm', async () => {
    const par = makeWorld({ profile: yesterdayProfile(2), checkedInPointsToday: true, balance: 1000 });
    const results = await Promise.all(Array.from({ length: 5 }, () => par.svc.run('u1')));

    expectOneGrantPerHalf(results, { points: false, water: true });
    expect(par.db.user.pointsBalance).toBe(1000);
    expect(par.db.ledger).toHaveLength(1);
    expect(par.db.checkIns).toHaveLength(1);
    expect(par.db.profile!.streakDays).toBe(3);
    expect(par.seasonPass.addXp).toHaveBeenCalledTimes(1);
  });

  it('giọt nước đã xong từ trước, Điểm Xanh chưa: 5 lời gọi song song chỉ cộng điểm một lần, KHÔNG cộng thêm nước', async () => {
    const done = { ...yesterdayProfile(3, 70), lastCheckInAt: new Date() };
    const par = makeWorld({ profile: done, balance: 0 });
    const results = await Promise.all(Array.from({ length: 5 }, () => par.svc.run('u1')));

    expectOneGrantPerHalf(results, { points: true, water: false });
    expect(par.db.profile!.totalSeeds).toBe(70);
    expect(par.db.ledger).toHaveLength(1);
    expect(par.db.checkIns).toHaveLength(1);
    expect(par.db.user.pointsBalance).toBeGreaterThan(0);
    expect(par.seasonPass.addXp).not.toHaveBeenCalled();
  });

  it('bấm lại tuần tự sau đó: alreadyDone, không cộng thêm gì (kết quả giống một lời gọi thua race)', async () => {
    const par = makeWorld();
    await Promise.all(Array.from({ length: 4 }, () => par.svc.run('u1')));
    const balance = par.db.user.pointsBalance;
    const seeds = par.db.profile!.totalSeeds;

    const again = await par.svc.run('u1');

    expect(again).toEqual({ points: null, water: null, alreadyDone: true, pending: [] });
    expect(par.db.user.pointsBalance).toBe(balance);
    expect(par.db.profile!.totalSeeds).toBe(seeds);
    expect(par.db.ledger).toHaveLength(1);
  });
});
