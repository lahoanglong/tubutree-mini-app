import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import { startOfVnDay } from '../../common/vn-time';
import { GameArcadeService } from './game-arcade.service';
import {
  ARCADE_GAME_IDS,
  ARCADE_NOMINAL_MS,
  arcadeDailyCap,
  arcadeMaxScore,
  arcadeWater,
  arcadeWindowAt,
  nextArcadeWindowStart,
  type ArcadeGameId,
} from './game-arcade.constants';

/** 'HH:MM:SS' giờ VN của ngày 15/11/2026 (UTC+7, không DST) thành Date, độc lập TZ của process. */
const vn = (hms: string, day = '2026-11-15') => new Date(`${day}T${hms}+07:00`);

type EventRow = { userId: string; delta: number; reason: string; refId: string | null; createdAt: Date };
type ScoreRow = { id: string; userId: string; gameId: string; bestScore: number; plays: number; lastRunAt: Date | null };
type PointRow = { id: string; userId: string; delta: number; lot: string; reason: string; refType: string | null; refId: string | null; expiresAt: Date | null };

interface WorldOpts {
  cfg?: Record<string, unknown>;
  user?: { zaloId: string | null; phone: string | null };
  noProfile?: boolean;
  seeds?: number;
  /** Bỏ khoá users của tx: kiểm backstop unique khi hai tx cùng đọc "còn chỗ". */
  noLock?: boolean;
  /** Hồ sơ game biến mất giữa lúc ensure và lúc vào tx (gộp tài khoản chạy xen vào). */
  vanishProfile?: boolean;
}

const USER = 'u1';
const EXPIRES = new Date('2027-11-15T00:00:00.000Z');

/** DB trong bộ nhớ đủ cho GameArcadeService: khoá `users` FOR UPDATE xếp hàng theo user, tx lỗi thì khôi phục trạng thái. */
function makeWorld(opts: WorldOpts = {}) {
  const cfg: Record<string, unknown> = { ...(opts.cfg ?? {}) };
  const users = new Map([[USER, { id: USER, ...(opts.user ?? { zaloId: 'z-real', phone: null }), pointsBalance: 0 }]]);
  let profiles = new Map<string, { userId: string; totalSeeds: number }>(
    opts.noProfile ? [] : [[USER, { userId: USER, totalSeeds: opts.seeds ?? 0 }]],
  );
  let scores: ScoreRow[] = [];
  let events: EventRow[] = [];
  let points: PointRow[] = [];
  let seq = 0;
  const lockTails = new Map<string, Promise<void>>();

  const acquire = async (key: string): Promise<() => void> => {
    const prev = lockTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    lockTails.set(key, prev.then(() => next));
    await prev;
    return release;
  };
  const snapshot = () => ({
    profiles: new Map([...profiles].map(([k, v]) => [k, { ...v }] as const)),
    scores: scores.map((r) => ({ ...r })),
    events: events.map((r) => ({ ...r })),
    points: points.map((r) => ({ ...r })),
    balances: new Map([...users].map(([k, v]) => [k, v.pointsBalance] as const)),
  });
  const restore = (s: ReturnType<typeof snapshot>) => {
    profiles = s.profiles;
    scores = s.scores;
    events = s.events;
    points = s.points;
    for (const [k, v] of s.balances) users.get(k)!.pointsBalance = v;
  };

  const eventMatches = (e: EventRow, where: { userId?: string; reason?: string | { in: string[] }; createdAt?: { gte: Date } }) =>
    (where.userId === undefined || e.userId === where.userId) &&
    (where.reason === undefined || (typeof where.reason === 'string' ? e.reason === where.reason : where.reason.in.includes(e.reason))) &&
    (where.createdAt === undefined || e.createdAt >= where.createdAt.gte);

  const gameWaterEvent = {
    count: jest.fn(async ({ where }: { where: Parameters<typeof eventMatches>[1] }) => events.filter((e) => eventMatches(e, where)).length),
    findUnique: jest.fn(async ({ where }: { where: { reason_refId: { reason: string; refId: string } } }) => {
      const { reason, refId } = where.reason_refId;
      return events.some((e) => e.reason === reason && e.refId === refId) ? { id: 'ev' } : null;
    }),
    createMany: jest.fn(async ({ data, skipDuplicates }: { data: EventRow[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const row of data) {
        if (events.some((e) => e.reason === row.reason && e.refId === row.refId)) {
          if (!skipDuplicates) throw new Error('P2002');
          continue;
        }
        events.push({ ...row });
        count++;
      }
      return { count };
    }),
    groupBy: jest.fn(async ({ where }: { where: Parameters<typeof eventMatches>[1] }) => {
      const by = new Map<string, number>();
      for (const e of events.filter((x) => eventMatches(x, where))) by.set(e.reason, (by.get(e.reason) ?? 0) + 1);
      return [...by].map(([reason, n]) => ({ reason, _count: { _all: n } }));
    }),
  };
  const gameArcadeScore = {
    findUnique: jest.fn(async ({ where }: { where: { userId_gameId: { userId: string; gameId: string } } }) => {
      const { userId, gameId } = where.userId_gameId;
      const row = scores.find((s) => s.userId === userId && s.gameId === gameId);
      return row ? { ...row } : null;
    }),
    findMany: jest.fn(async ({ where }: { where: { userId: string } }) => scores.filter((s) => s.userId === where.userId).map((s) => ({ ...s }))),
    create: jest.fn(async ({ data }: { data: Omit<ScoreRow, 'id'> }) => {
      scores.push({ id: `s${++seq}`, ...data });
      return {};
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: { bestScore: number; plays: { increment: number }; lastRunAt: Date } }) => {
      const row = scores.find((s) => s.id === where.id)!;
      row.bestScore = data.bestScore;
      row.plays += data.plays.increment;
      row.lastRunAt = data.lastRunAt;
      return {};
    }),
  };
  const gameProfile = {
    findUnique: jest.fn(async ({ where }: { where: { userId: string } }) => {
      const p = profiles.get(where.userId);
      return p ? { ...p } : null;
    }),
    create: jest.fn(async ({ data }: { data: { userId: string } }) => {
      profiles.set(data.userId, { userId: data.userId, totalSeeds: 0 });
      return { userId: data.userId };
    }),
    update: jest.fn(async ({ where, data }: { where: { userId: string }; data: { totalSeeds: { increment: number } } }) => {
      const p = profiles.get(where.userId)!;
      p.totalSeeds += data.totalSeeds.increment;
      return { totalSeeds: p.totalSeeds };
    }),
  };
  const pointsTransaction = {
    createManyAndReturn: jest.fn(async ({ data, skipDuplicates }: { data: Omit<PointRow, 'id'>[]; skipDuplicates?: boolean }) => {
      const out: { id: string }[] = [];
      for (const row of data) {
        if (points.some((p) => p.reason === row.reason && p.refId === row.refId)) {
          if (!skipDuplicates) throw new Error('P2002');
          continue;
        }
        const id = `p${++seq}`;
        points.push({ id, ...row });
        out.push({ id });
      }
      return out;
    }),
  };
  const user = {
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
      const u = users.get(where.id);
      return u ? { zaloId: u.zaloId, phone: u.phone } : null;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: { pointsBalance: { increment: number } } }) => {
      users.get(where.id)!.pointsBalance += data.pointsBalance.increment;
      return {};
    }),
  };

  const prisma = {
    user: { findUnique: user.findUnique },
    gameProfile: { findUnique: gameProfile.findUnique, create: gameProfile.create },
    gameArcadeScore: { findMany: gameArcadeScore.findMany },
    gameWaterEvent: { groupBy: gameWaterEvent.groupBy, findUnique: gameWaterEvent.findUnique },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const held: Array<() => void> = [];
      const before = snapshot();
      const tx = {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join('?');
          if (sql.includes('FROM "users"')) {
            if (!opts.noLock) held.push(await acquire(values[0] as string));
            return [{ id: values[0] }];
          }
          if (sql.includes('FROM "game_profiles"')) {
            const p = profiles.get(values[0] as string);
            return opts.vanishProfile || !p ? [] : [{ totalSeeds: p.totalSeeds }];
          }
          throw new Error(`SQL không mong đợi: ${sql}`);
        }),
        gameWaterEvent,
        gameArcadeScore,
        gameProfile,
        pointsTransaction,
        user,
      };
      try {
        return await fn(tx);
      } catch (e) {
        restore(before);
        throw e;
      } finally {
        for (const release of held) release();
      }
    }),
  };
  const config = { get: jest.fn(async (k: string, d: unknown) => (k in cfg ? cfg[k] : d)) };
  const loyalty = { pointsExpiresAt: jest.fn(async () => EXPIRES) };
  const svc = new GameArcadeService(prisma as unknown as PrismaService, config as unknown as SystemConfigService, loyalty as unknown as LoyaltyService);
  const seedToday = (gameId: ArcadeGameId, n: number, at: Date) => {
    const reason = gameId === 'dew_catcher' ? 'ARCADE_DEW_CATCHER' : 'ARCADE_REFILL_RUSH';
    for (let i = 1; i <= n; i++) events.push({ userId: USER, delta: 5, reason, refId: `${USER}:old:${i}:${gameId}`, createdAt: at });
  };
  const seedScore = (gameId: ArcadeGameId) => scores.push({ id: `s${++seq}`, userId: USER, gameId, bestScore: 0, plays: 0, lastRunAt: null });
  return {
    svc,
    cfg,
    loyalty,
    prisma,
    tx: { gameWaterEvent, gameArcadeScore, gameProfile, pointsTransaction, user },
    state: {
      get events() {
        return events;
      },
      get scores() {
        return scores;
      },
      get points() {
        return points;
      },
      get profile() {
        return profiles.get(USER);
      },
      get balance() {
        return users.get(USER)!.pointsBalance;
      },
    },
    seedToday,
    seedScore,
  };
}

const run = (score = 300, durationMs = 40_000) => ({ gameId: 'dew_catcher' as const, score, durationMs });
const T0 = vn('12:00:00');
const sumPoints = (rows: PointRow[]) => rows.reduce((s, r) => s + r.delta, 0);

describe('khung giờ thưởng theo giờ VN (thuần số học, không phụ thuộc TZ của process)', () => {
  const cases: [string, ReturnType<typeof arcadeWindowAt>][] = [
    ['06:29:59.999', null],
    ['06:30:00', 'SUONG_SOM'],
    ['08:59:59', 'SUONG_SOM'],
    ['09:00:00', null],
    ['19:59:59', null],
    ['20:00:00', 'MUA_RAO'],
    ['21:59:59', 'MUA_RAO'],
    ['22:00:00', null],
    ['00:00:00', null],
    ['12:00:00', null],
  ];
  it.each(cases)('%s giờ VN: khung %p', (hms, window) => {
    const t = vn(hms);
    expect(arcadeWindowAt(t)).toBe(window);
    expect(arcadeDailyCap(t)).toBe(window ? 4 : 3);
  });

  it('mốc UTC đổi sang giờ VN đúng (UTC+7), không dùng giờ local của process', () => {
    expect(arcadeWindowAt(new Date('2026-11-14T23:30:00Z'))).toBe('SUONG_SOM'); // 06:30 VN
    expect(arcadeWindowAt(new Date('2026-11-15T06:30:00Z'))).toBeNull(); // 13:30 VN
    expect(arcadeWindowAt(new Date('2026-11-15T13:00:00Z'))).toBe('MUA_RAO'); // 20:00 VN
    expect(arcadeWindowAt(new Date('2026-11-15T15:00:00Z'))).toBeNull(); // 22:00 VN
  });

  it('khung kế tiếp là khung gần nhất SAU thời điểm hiện tại', () => {
    expect(nextArcadeWindowStart(vn('05:00:00')).toISOString()).toBe(vn('06:30:00').toISOString());
    expect(nextArcadeWindowStart(vn('06:30:00')).toISOString()).toBe(vn('20:00:00').toISOString());
    expect(nextArcadeWindowStart(vn('12:00:00')).toISOString()).toBe(vn('20:00:00').toISOString());
    expect(nextArcadeWindowStart(vn('20:00:00')).toISOString()).toBe(vn('06:30:00', '2026-11-16').toISOString());
    expect(nextArcadeWindowStart(vn('23:59:59')).toISOString()).toBe(vn('06:30:00', '2026-11-16').toISOString());
  });
});

describe('điểm thưởng giọt nước và trần điểm', () => {
  it('mốc khá và xuất sắc: 5, 8, 10 giọt (dew 400/900, rush 250/550)', () => {
    expect([0, 399, 400, 899, 900, 2000].map((s) => arcadeWater('dew_catcher', s, 5))).toEqual([5, 5, 8, 8, 10, 10]);
    expect([0, 249, 250, 549, 550].map((s) => arcadeWater('refill_rush', s, 5))).toEqual([5, 5, 8, 8, 10]);
    expect(arcadeWater('dew_catcher', 900, 7)).toBe(12);
  });

  it('trần điểm một giây: dew 120/s, rush 60/s, làm tròn lên', () => {
    expect(arcadeMaxScore('dew_catcher', 40_000)).toBe(4800);
    expect(arcadeMaxScore('refill_rush', 45_000)).toBe(2700);
    expect(arcadeMaxScore('dew_catcher', 5_000)).toBe(600);
    expect(arcadeMaxScore('dew_catcher', 5_001)).toBe(601);
  });
});

describe('GameArcadeService.complete: kiểm tra ván chơi (400 trước khi chạm DB)', () => {
  const bad = async (input: Record<string, unknown>) => {
    const w = makeWorld();
    await expect(w.svc.complete(USER, input as never, T0)).rejects.toBeInstanceOf(BadRequestException);
    expect(w.prisma.$transaction).not.toHaveBeenCalled();
    expect(w.state.events).toHaveLength(0);
    expect(w.state.scores).toHaveLength(0);
  };

  it('thời lượng dưới 5 giây hoặc quá thời lượng danh nghĩa cộng 10 giây', async () => {
    await bad({ ...run(10), durationMs: 4_999 });
    await bad({ ...run(10), durationMs: 0 });
    await bad({ ...run(10), durationMs: -40_000 });
    await bad({ ...run(10), durationMs: 50_001 }); // dew: 40s + 10s
    await bad({ gameId: 'refill_rush', score: 10, durationMs: 55_001 }); // rush: 45s + 10s
  });

  it('ranh hợp lệ: đúng 5.000 ms và đúng nominal + 10.000 ms', async () => {
    const a = makeWorld();
    await expect(a.svc.complete(USER, run(10, 5_000), T0)).resolves.toMatchObject({ rewarded: true });
    const b = makeWorld();
    await expect(b.svc.complete(USER, run(10, 50_000), T0)).resolves.toMatchObject({ rewarded: true });
    const c = makeWorld();
    await expect(c.svc.complete(USER, { gameId: 'refill_rush', score: 10, durationMs: 55_000 }, T0)).resolves.toMatchObject({ rewarded: true });
  });

  it('điểm vượt trần điểm mỗi giây của thời lượng đã khai', async () => {
    await bad({ ...run(601, 5_000) });
    await bad({ ...run(4_801, 40_000) });
    await bad({ gameId: 'refill_rush', score: 2_701, durationMs: 45_000 });
    const ok = makeWorld();
    await expect(ok.svc.complete(USER, run(600, 5_000), T0)).resolves.toMatchObject({ bestScore: 600 });
  });

  it('điểm âm, điểm hoặc thời lượng không nguyên/NaN, game lạ', async () => {
    await bad({ ...run(-1) });
    await bad({ ...run(10.5) });
    await bad({ ...run(Number.NaN) });
    await bad({ ...run(10), durationMs: 40_000.5 });
    await bad({ ...run(10), durationMs: Number.NaN });
    await bad({ gameId: 'tetris', score: 10, durationMs: 40_000 });
  });

  it('câu lỗi là tiếng Việt thân thiện, không chữ cấm', async () => {
    const w = makeWorld();
    const messages: string[] = [];
    for (const input of [{ ...run(10), durationMs: 1_000 }, { ...run(10), durationMs: 90_000 }, run(9_999)]) {
      try {
        await w.svc.complete(USER, input, T0);
      } catch (e) {
        messages.push((e as BadRequestException).message);
      }
    }
    expect(messages).toHaveLength(3);
    for (const m of messages) {
      expect(m).toMatch(/bạn/i);
      expect(m).not.toMatch(/vui lòng|chúng tôi/i);
    }
  });
});

describe('GameArcadeService.complete: thưởng', () => {
  it('ván đủ điều kiện cộng giọt nước vào hồ sơ và ghi sổ lượt, không cắt theo sức chứa bình', async () => {
    const w = makeWorld({ seeds: 5_000 });
    const res = await w.svc.complete(USER, run(300), T0);
    expect(res).toEqual({
      gameId: 'dew_catcher',
      score: 300,
      bestScore: 300,
      isNewBest: true,
      rewarded: true,
      reason: null,
      waterEarned: 5,
      pointsEarned: 1,
      totalSeeds: 5_005,
      used: 1,
      cap: 3,
      window: null,
      windowBonus: false,
    });
    expect(w.state.profile!.totalSeeds).toBe(5_005);
    expect(w.state.events).toEqual([
      { userId: USER, delta: 5, reason: 'ARCADE_DEW_CATCHER', refId: `${USER}:2026-11-15:1`, createdAt: T0 },
    ]);
  });

  it.each([
    [399, 5],
    [400, 8],
    [899, 8],
    [900, 10],
  ])('dew điểm %i: %i giọt', async (score, water) => {
    const w = makeWorld();
    await expect(w.svc.complete(USER, run(score), T0)).resolves.toMatchObject({ waterEarned: water, totalSeeds: water });
  });

  it('refill_rush dùng sổ lượt riêng và mốc điểm riêng', async () => {
    const w = makeWorld();
    const res = await w.svc.complete(USER, { gameId: 'refill_rush', score: 550, durationMs: 45_000 }, T0);
    expect(res).toMatchObject({ rewarded: true, waterEarned: 10 });
    expect(w.state.events[0]).toMatchObject({ reason: 'ARCADE_REFILL_RUSH', delta: 10 });
  });

  it('giọt nền đọc từ game.arcade_water_base; giá trị hỏng rơi về mặc định 5, quá biên bị kẹp 50', async () => {
    const a = makeWorld({ cfg: { 'game.arcade_water_base': 7 } });
    await expect(a.svc.complete(USER, run(900), T0)).resolves.toMatchObject({ waterEarned: 12 });
    const b = makeWorld({ cfg: { 'game.arcade_water_base': 'abc' } });
    await expect(b.svc.complete(USER, run(10), T0)).resolves.toMatchObject({ waterEarned: 5 });
    const c = makeWorld({ cfg: { 'game.arcade_water_base': -3 } });
    await expect(c.svc.complete(USER, run(10), T0)).resolves.toMatchObject({ waterEarned: 5 });
    const d = makeWorld({ cfg: { 'game.arcade_water_base': 99_999 } });
    await expect(d.svc.complete(USER, run(10), T0)).resolves.toMatchObject({ waterEarned: 50 });
  });

  it('cộng Điểm Xanh bằng sổ lô STANDARD có hạn, cùng transaction, số dư khớp tổng sổ', async () => {
    const w = makeWorld();
    const res = await w.svc.complete(USER, run(10), T0);
    expect(res.pointsEarned).toBe(1);
    expect(w.state.points).toEqual([
      expect.objectContaining({
        userId: USER,
        delta: 1,
        lot: 'STANDARD',
        reason: 'GAME_ARCADE:dew_catcher',
        refType: 'GAME',
        refId: `${USER}:2026-11-15:1`,
        expiresAt: EXPIRES,
      }),
    ]);
    expect(w.loyalty.pointsExpiresAt).toHaveBeenCalledWith(T0);
    expect(w.state.balance).toBe(sumPoints(w.state.points));
    await w.svc.complete(USER, run(10), new Date(T0.getTime() + 60_000));
    expect(w.state.balance).toBe(2);
    expect(w.state.balance).toBe(sumPoints(w.state.points));
    expect(new Set(w.state.points.map((p) => p.refId)).size).toBe(2);
  });

  it('game.arcade_points_per_run = 0 hoặc hỏng thì không cộng điểm và không đọc hạn điểm; quá biên kẹp 10', async () => {
    for (const bad of [0, 'abc', -1, null]) {
      const w = makeWorld({ cfg: { 'game.arcade_points_per_run': bad } });
      await expect(w.svc.complete(USER, run(10), T0)).resolves.toMatchObject({ rewarded: true, pointsEarned: 0 });
      expect(w.state.points).toHaveLength(0);
      expect(w.state.balance).toBe(0);
      expect(w.loyalty.pointsExpiresAt).not.toHaveBeenCalled();
    }
    const big = makeWorld({ cfg: { 'game.arcade_points_per_run': 1_000_000 } });
    await expect(big.svc.complete(USER, run(10), T0)).resolves.toMatchObject({ pointsEarned: 10 });
    expect(big.state.balance).toBe(sumPoints(big.state.points));
  });

  it('kỷ lục chỉ tăng, số ván tăng mỗi ván', async () => {
    const w = makeWorld();
    const at = (i: number) => new Date(T0.getTime() + i * 60_000);
    const r1 = await w.svc.complete(USER, run(300), at(0));
    const r2 = await w.svc.complete(USER, run(200), at(1));
    const r3 = await w.svc.complete(USER, run(500), at(2));
    const r4 = await w.svc.complete(USER, run(500), at(3));
    expect([r1, r2, r3, r4].map((r) => [r.bestScore, r.isNewBest])).toEqual([
      [300, true],
      [300, false],
      [500, true],
      [500, false],
    ]);
    expect(w.state.scores).toHaveLength(1);
    expect(w.state.scores[0]).toMatchObject({ bestScore: 500, plays: 4, lastRunAt: at(3) });
  });

  it('mỗi game có kỷ lục riêng', async () => {
    const w = makeWorld();
    await w.svc.complete(USER, run(300), T0);
    await w.svc.complete(USER, { gameId: 'refill_rush', score: 100, durationMs: 45_000 }, T0);
    expect(w.state.scores.map((s) => [s.gameId, s.bestScore])).toEqual([
      ['dew_catcher', 300],
      ['refill_rush', 100],
    ]);
  });
});

describe('GameArcadeService.complete: trần lượt thưởng mỗi ngày VN', () => {
  it('ngoài khung giờ: 3 lượt, ván thứ 4 vẫn chơi và phá kỷ lục nhưng không thưởng', async () => {
    const w = makeWorld();
    const at = (i: number) => new Date(T0.getTime() + i * 60_000);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await w.svc.complete(USER, run(100 + i * 100), at(i)));
    expect(results.map((r) => [r.rewarded, r.reason, r.used, r.cap])).toEqual([
      [true, null, 1, 3],
      [true, null, 2, 3],
      [true, null, 3, 3],
      [false, 'DAILY_CAP', 3, 3],
    ]);
    expect(results[3]).toMatchObject({ waterEarned: 0, pointsEarned: 0, bestScore: 400, isNewBest: true, totalSeeds: 15 });
    expect(w.state.events).toHaveLength(3);
    expect(w.state.points).toHaveLength(3);
    expect(w.state.scores[0]).toMatchObject({ bestScore: 400, plays: 4 });
    expect(w.state.balance).toBe(sumPoints(w.state.points));
  });

  it('trong khung giờ: 4 lượt, ván thứ 5 hết lượt', async () => {
    const w = makeWorld();
    const start = vn('07:00:00');
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await w.svc.complete(USER, run(100), new Date(start.getTime() + i * 60_000)));
    expect(results.map((r) => [r.rewarded, r.used, r.cap, r.window, r.windowBonus])).toEqual([
      [true, 1, 4, 'SUONG_SOM', true],
      [true, 2, 4, 'SUONG_SOM', true],
      [true, 3, 4, 'SUONG_SOM', true],
      [true, 4, 4, 'SUONG_SOM', true],
      [false, 4, 4, 'SUONG_SOM', true],
    ]);
  });

  // 3 lượt đã dùng sáng sớm; ván hoàn thành đúng ranh quyết định có thêm lượt hay không.
  const boundaries: [string, boolean, string | null][] = [
    ['06:29:59', false, null],
    ['06:30:00', true, 'SUONG_SOM'],
    ['08:59:59', true, 'SUONG_SOM'],
    ['09:00:00', false, null],
    ['19:59:59', false, null],
    ['20:00:00', true, 'MUA_RAO'],
    ['21:59:59', true, 'MUA_RAO'],
    ['22:00:00', false, null],
  ];
  it.each(boundaries)('đã dùng 3 lượt, hoàn thành lúc %s giờ VN: còn lượt thứ 4 = %s', async (hms, rewarded, window) => {
    const w = makeWorld();
    const now = vn(hms);
    w.seedToday('dew_catcher', 3, vn('00:30:00'));
    const res = await w.svc.complete(USER, run(100), now);
    expect(res).toMatchObject({ rewarded, window, windowBonus: window !== null, cap: window ? 4 : 3, used: rewarded ? 4 : 3 });
    expect(res.reason).toBe(rewarded ? null : 'DAILY_CAP');
    expect(res.waterEarned).toBe(rewarded ? 5 : 0);
    expect(w.state.events).toHaveLength(rewarded ? 4 : 3);
  });

  it('trần tính theo lúc HOÀN THÀNH: dùng 4 lượt trong khung, ván xong sau khung thì hết lượt', async () => {
    const w = makeWorld();
    w.seedToday('dew_catcher', 4, vn('08:00:00'));
    await expect(w.svc.complete(USER, run(100), vn('09:00:00'))).resolves.toMatchObject({ rewarded: false, reason: 'DAILY_CAP', used: 4, cap: 3 });
  });

  it('mỗi game một trần riêng', async () => {
    const w = makeWorld();
    w.seedToday('dew_catcher', 3, vn('00:30:00'));
    await expect(w.svc.complete(USER, run(100), T0)).resolves.toMatchObject({ rewarded: false, reason: 'DAILY_CAP' });
    await expect(
      w.svc.complete(USER, { gameId: 'refill_rush', score: 100, durationMs: 45_000 }, T0),
    ).resolves.toMatchObject({ rewarded: true, used: 1 });
  });

  it('sang ngày VN mới (00:00 giờ VN) trần được làm mới, lượt hôm qua không tính', async () => {
    const w = makeWorld();
    w.seedToday('dew_catcher', 3, vn('23:59:59', '2026-11-14'));
    const res = await w.svc.complete(USER, run(100), vn('00:00:00'));
    expect(res).toMatchObject({ rewarded: true, used: 1, cap: 3 });
    expect(w.state.events.at(-1)!.refId).toBe(`${USER}:2026-11-15:1`);
    expect(startOfVnDay(vn('00:00:00')).toISOString()).toBe(vn('00:00:00').toISOString());
  });

  it('hai ván hoàn thành song song lúc còn đúng 1 lượt: chỉ một ván ăn lượt', async () => {
    const w = makeWorld();
    w.seedToday('dew_catcher', 2, vn('00:30:00'));
    const [a, b] = await Promise.all([
      w.svc.complete(USER, run(100), new Date(T0.getTime())),
      w.svc.complete(USER, run(100), new Date(T0.getTime() + 60_000)),
    ]);
    expect([a.rewarded, b.rewarded].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.rewarded)!.reason).toBe('DAILY_CAP');
    expect(w.state.events).toHaveLength(3);
    expect(w.state.points).toHaveLength(1);
    expect(w.state.profile!.totalSeeds).toBe(5);
    expect(w.state.balance).toBe(sumPoints(w.state.points));
  });

  it('hai ván cùng giờ hoàn thành song song: ván thứ hai chưa kịp chơi xong nên TOO_FAST, chỉ một lượt bị tiêu', async () => {
    const w = makeWorld();
    const [a, b] = await Promise.all([w.svc.complete(USER, run(100), T0), w.svc.complete(USER, run(100), T0)]);
    expect([a.reason, b.reason]).toEqual([null, 'TOO_FAST']);
    expect(w.state.events).toHaveLength(1);
    expect(w.state.scores[0]!.plays).toBe(1);
  });

  it('backstop unique: hai tx cùng đọc "còn chỗ" (không khoá) vẫn không vượt trần, tx thua thành DAILY_CAP mà không mất kỷ lục', async () => {
    const w = makeWorld({ noLock: true });
    w.seedToday('dew_catcher', 2, vn('00:30:00'));
    w.seedScore('dew_catcher');
    const [a, b] = await Promise.all([
      w.svc.complete(USER, run(100), T0),
      w.svc.complete(USER, run(700), new Date(T0.getTime() + 60_000)),
    ]);
    expect([a.rewarded, b.rewarded].filter(Boolean)).toHaveLength(1);
    const loser = [a, b].find((r) => !r.rewarded)!;
    expect(loser).toMatchObject({ reason: 'DAILY_CAP', used: 3 });
    expect(w.state.events).toHaveLength(3);
    expect(w.state.points).toHaveLength(1);
    expect(w.state.scores[0]!.plays).toBe(2);
  });
});

describe('GameArcadeService.complete: chống chạy nhanh (TOO_FAST)', () => {
  it('ván mới bắt đầu trước khi ván cũ kết thúc: không thưởng, không ghi kỷ lục, không đổi lastRunAt', async () => {
    const w = makeWorld();
    await w.svc.complete(USER, run(300), T0);
    const second = new Date(T0.getTime() + 10_000); // báo xong sau 10s mà khai ván dài 40s
    const res = await w.svc.complete(USER, run(900), second);
    expect(res).toMatchObject({
      rewarded: false,
      reason: 'TOO_FAST',
      isNewBest: false,
      bestScore: 300,
      waterEarned: 0,
      pointsEarned: 0,
      used: 1,
      totalSeeds: 5,
    });
    expect(w.state.scores[0]).toMatchObject({ bestScore: 300, plays: 1, lastRunAt: T0 });
    expect(w.state.events).toHaveLength(1);
    expect(w.state.points).toHaveLength(1);
  });

  it('ranh: bắt đầu đúng 3 giây trước lúc ván cũ xong vẫn hợp lệ, trễ hơn 1 ms là TOO_FAST', async () => {
    const dur = 40_000;
    const ok = makeWorld();
    await ok.svc.complete(USER, run(100, dur), T0);
    await expect(ok.svc.complete(USER, run(100, dur), new Date(T0.getTime() + dur - 3_000))).resolves.toMatchObject({ rewarded: true });
    const fast = makeWorld();
    await fast.svc.complete(USER, run(100, dur), T0);
    await expect(fast.svc.complete(USER, run(100, dur), new Date(T0.getTime() + dur - 3_001))).resolves.toMatchObject({ reason: 'TOO_FAST' });
  });

  it('ván nối tiếp bình thường (bấm chơi lại ngay) không bị chặn', async () => {
    const w = makeWorld();
    await w.svc.complete(USER, run(100), T0);
    await expect(w.svc.complete(USER, run(100), new Date(T0.getTime() + 41_000))).resolves.toMatchObject({ rewarded: true, used: 2 });
  });

  it('chặn theo từng game: ván game khác không tính', async () => {
    const w = makeWorld();
    await w.svc.complete(USER, run(100), T0);
    await expect(
      w.svc.complete(USER, { gameId: 'refill_rush', score: 100, durationMs: 45_000 }, new Date(T0.getTime() + 1_000)),
    ).resolves.toMatchObject({ rewarded: true });
  });
});

describe('GameArcadeService.complete: khách vãng lai và công tắc tắt', () => {
  it('khách vãng lai (zaloId guest_, không SĐT): ghi kỷ lục, không thưởng, không tạo hồ sơ game, không đọc hạn điểm', async () => {
    const w = makeWorld({ user: { zaloId: 'guest_h_abc', phone: null }, noProfile: true });
    const res = await w.svc.complete(USER, run(900), T0);
    expect(res).toMatchObject({ rewarded: false, reason: 'NOT_REAL_USER', waterEarned: 0, pointsEarned: 0, totalSeeds: 0, bestScore: 900, isNewBest: true });
    expect(w.state.events).toHaveLength(0);
    expect(w.state.points).toHaveLength(0);
    expect(w.state.profile).toBeUndefined();
    expect(w.state.scores[0]).toMatchObject({ bestScore: 900, plays: 1 });
    expect(w.loyalty.pointsExpiresAt).not.toHaveBeenCalled();
  });

  it('khách guest_ nhưng đã có SĐT xác thực là user thật', async () => {
    const w = makeWorld({ user: { zaloId: 'guest_h_abc', phone: '0912345678' } });
    await expect(w.svc.complete(USER, run(100), T0)).resolves.toMatchObject({ rewarded: true });
  });

  it('game.arcade_enabled = false (hoặc "false"): vẫn ghi kỷ lục, không thưởng, không quảng cáo khung giờ', async () => {
    for (const off of [false, 'false']) {
      const w = makeWorld({ cfg: { 'game.arcade_enabled': off }, noProfile: true });
      const res = await w.svc.complete(USER, run(500), vn('07:00:00'));
      expect(res).toMatchObject({ rewarded: false, reason: 'DISABLED', waterEarned: 0, pointsEarned: 0, bestScore: 500, window: null, windowBonus: false, cap: 3 });
      expect(w.state.events).toHaveLength(0);
      expect(w.state.points).toHaveLength(0);
      expect(w.state.profile).toBeUndefined();
      expect(w.state.scores[0]).toMatchObject({ bestScore: 500, plays: 1 });
    }
  });

  it('mặc định bật khi chưa có khoá hoặc giá trị lạ', async () => {
    for (const cfg of [{}, { 'game.arcade_enabled': true }, { 'game.arcade_enabled': 'abc' }]) {
      const w = makeWorld({ cfg });
      await expect(w.svc.complete(USER, run(100), T0)).resolves.toMatchObject({ rewarded: true });
    }
  });

  it('hồ sơ game biến mất giữa chừng: báo thử lại và không ghi gì (kể cả kỷ lục)', async () => {
    const w = makeWorld({ vanishProfile: true });
    await expect(w.svc.complete(USER, run(100), T0)).rejects.toBeInstanceOf(ConflictException);
    expect(w.state.scores).toHaveLength(0);
    expect(w.state.events).toHaveLength(0);
  });
});

describe('GameArcadeService.status', () => {
  it('trả kỷ lục, số ván, lượt đã dùng và trần của từng game, khung giờ và mốc kế tiếp', async () => {
    const w = makeWorld();
    await w.svc.complete(USER, run(300), vn('07:00:00'));
    await w.svc.complete(USER, run(500), vn('07:02:00'));
    await w.svc.complete(USER, { gameId: 'refill_rush', score: 200, durationMs: 45_000 }, vn('07:03:00'));
    const status = await w.svc.status(USER, vn('07:10:00'));
    expect(status).toEqual({
      games: {
        dew_catcher: { bestScore: 500, plays: 2, used: 2, cap: 4 },
        refill_rush: { bestScore: 200, plays: 1, used: 1, cap: 4 },
      },
      window: 'SUONG_SOM',
      windowBonus: true,
      nextWindowAt: vn('20:00:00').toISOString(),
      quizClaimed: false,
    });
    expect(Object.keys(status.games).sort()).toEqual([...ARCADE_GAME_IDS].sort());
  });

  it('người mới: mọi số 0, ngoài khung giờ trần 3; lượt hôm qua không tính', async () => {
    const w = makeWorld();
    w.seedToday('dew_catcher', 3, vn('10:00:00', '2026-11-14'));
    await expect(w.svc.status(USER, T0)).resolves.toEqual({
      games: {
        dew_catcher: { bestScore: 0, plays: 0, used: 0, cap: 3 },
        refill_rush: { bestScore: 0, plays: 0, used: 0, cap: 3 },
      },
      window: null,
      windowBonus: false,
      nextWindowAt: vn('20:00:00').toISOString(),
      quizClaimed: false,
    });
  });

  it('quizClaimed theo dòng HOME_QUIZ_BONUS của chính user', async () => {
    const w = makeWorld();
    await w.svc.completeHomeQuiz(USER, T0);
    await expect(w.svc.status(USER, T0)).resolves.toMatchObject({ quizClaimed: true });
  });

  it('game tắt: không quảng cáo khung giờ và không có mốc kế tiếp', async () => {
    const w = makeWorld({ cfg: { 'game.arcade_enabled': false } });
    await expect(w.svc.status(USER, vn('07:10:00'))).resolves.toMatchObject({ window: null, windowBonus: false, nextWindowAt: null });
  });
});

describe('GameArcadeService.completeHomeQuiz', () => {
  it('thưởng 20 giọt một lần, ghi sổ HOME_QUIZ_BONUS với refId = userId', async () => {
    const w = makeWorld({ seeds: 10 });
    await expect(w.svc.completeHomeQuiz(USER, T0)).resolves.toEqual({ granted: 20, alreadyClaimed: false, totalSeeds: 30 });
    expect(w.state.events).toEqual([{ userId: USER, delta: 20, reason: 'HOME_QUIZ_BONUS', refId: USER, createdAt: T0 }]);
    expect(w.state.profile!.totalSeeds).toBe(30);
  });

  it('gọi lại: granted 0, alreadyClaimed true, không cộng thêm', async () => {
    const w = makeWorld();
    await w.svc.completeHomeQuiz(USER, T0);
    await expect(w.svc.completeHomeQuiz(USER, T0)).resolves.toEqual({ granted: 0, alreadyClaimed: true, totalSeeds: 20 });
    expect(w.state.events).toHaveLength(1);
    expect(w.state.profile!.totalSeeds).toBe(20);
  });

  it('hai lần gọi song song chỉ cộng một lần', async () => {
    const w = makeWorld();
    const results = await Promise.all([w.svc.completeHomeQuiz(USER, T0), w.svc.completeHomeQuiz(USER, T0), w.svc.completeHomeQuiz(USER, T0)]);
    expect(results.filter((r) => r.granted === 20)).toHaveLength(1);
    expect(results.filter((r) => r.alreadyClaimed)).toHaveLength(2);
    expect(w.state.profile!.totalSeeds).toBe(20);
  });

  it('backstop unique khi không khoá: tx thua trả alreadyClaimed và không cộng', async () => {
    const w = makeWorld({ noLock: true });
    const results = await Promise.all([w.svc.completeHomeQuiz(USER, T0), w.svc.completeHomeQuiz(USER, T0)]);
    expect(results.filter((r) => r.granted === 20)).toHaveLength(1);
    expect(w.state.profile!.totalSeeds).toBe(20);
    expect(w.state.events).toHaveLength(1);
  });

  it('khách vãng lai không nhận và không bị tạo hồ sơ game', async () => {
    const w = makeWorld({ user: { zaloId: 'guest_h_abc', phone: null }, noProfile: true });
    await expect(w.svc.completeHomeQuiz(USER, T0)).resolves.toEqual({ granted: 0, alreadyClaimed: false, totalSeeds: 0 });
    expect(w.state.events).toHaveLength(0);
    expect(w.state.profile).toBeUndefined();
  });

  it('user thật chưa có hồ sơ game: tạo hồ sơ rồi cộng', async () => {
    const w = makeWorld({ noProfile: true });
    await expect(w.svc.completeHomeQuiz(USER, T0)).resolves.toEqual({ granted: 20, alreadyClaimed: false, totalSeeds: 20 });
  });

  it('game.home_quiz_seeds đổi được; 0 thì không ghi sổ nên bật lại sau vẫn nhận; hỏng rơi về 20; quá biên kẹp 1000', async () => {
    const custom = makeWorld({ cfg: { 'game.home_quiz_seeds': 35 } });
    await expect(custom.svc.completeHomeQuiz(USER, T0)).resolves.toMatchObject({ granted: 35 });

    const off = makeWorld({ cfg: { 'game.home_quiz_seeds': 0 } });
    await expect(off.svc.completeHomeQuiz(USER, T0)).resolves.toEqual({ granted: 0, alreadyClaimed: false, totalSeeds: 0 });
    expect(off.state.events).toHaveLength(0);
    off.cfg['game.home_quiz_seeds'] = 20;
    await expect(off.svc.completeHomeQuiz(USER, T0)).resolves.toMatchObject({ granted: 20 });

    const broken = makeWorld({ cfg: { 'game.home_quiz_seeds': 'abc' } });
    await expect(broken.svc.completeHomeQuiz(USER, T0)).resolves.toMatchObject({ granted: 20 });
    const huge = makeWorld({ cfg: { 'game.home_quiz_seeds': 1e9 } });
    await expect(huge.svc.completeHomeQuiz(USER, T0)).resolves.toMatchObject({ granted: 1_000 });
  });
});

describe('khoá cấu hình mini-game: luật ghi của admin khớp biên đọc', () => {
  function configService() {
    const upsert = jest.fn().mockResolvedValue({});
    const base: Record<string, unknown> = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert },
      systemConfigHistory: { create: jest.fn() },
    };
    base.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(base));
    return { svc: new SystemConfigService(base as unknown as PrismaService), upsert };
  }

  it.each([
    ['game.arcade_water_base', 50],
    ['game.arcade_points_per_run', 10],
    ['game.home_quiz_seeds', 1_000],
  ])('%s: nhận 0 và max %i, từ chối max+1, số âm và số lẻ', async (key, max) => {
    const { svc } = configService();
    await expect(svc.set(key, 0, 'admin')).resolves.toBeUndefined();
    await expect(svc.set(key, max, 'admin')).resolves.toBeUndefined();
    await expect(svc.set(key, max + 1, 'admin')).rejects.toThrow(BadRequestException);
    await expect(svc.set(key, -1, 'admin')).rejects.toThrow(BadRequestException);
    await expect(svc.set(key, 1.5, 'admin')).rejects.toThrow(/số nguyên/);
  });

  it('Điểm Xanh mỗi ván không nhận giá trị gấp 1.000 lần (nhầm đơn vị xu)', async () => {
    const { svc, upsert } = configService();
    await expect(svc.set('game.arcade_points_per_run', 1_000, 'admin')).rejects.toThrow(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('game.arcade_enabled chỉ nhận true hoặc false, không nhận chuỗi', async () => {
    const { svc } = configService();
    await expect(svc.set('game.arcade_enabled', false, 'admin')).resolves.toBeUndefined();
    await expect(svc.set('game.arcade_enabled', true, 'admin')).resolves.toBeUndefined();
    await expect(svc.set('game.arcade_enabled', 'false', 'admin')).rejects.toThrow(BadRequestException);
    await expect(svc.set('game.arcade_enabled', 0, 'admin')).rejects.toThrow(BadRequestException);
  });

  it('hằng thời lượng danh nghĩa khớp contract', () => {
    expect(ARCADE_NOMINAL_MS).toEqual({ dew_catcher: 40_000, refill_rush: 45_000 });
  });
});
