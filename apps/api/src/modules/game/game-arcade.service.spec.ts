import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import { startOfVnDay, vnDateKey } from '../../common/vn-time';
import { GameArcadeService } from './game-arcade.service';
import {
  ARCADE_GAME_IDS,
  ARCADE_MAX_SCORE_PER_SEC,
  ARCADE_MIN_REWARD_SCORE,
  ARCADE_NOMINAL_MS,
  ARCADE_RUN_SLACK_MS,
  ARCADE_RUN_TTL_MS,
  arcadeBaseRefId,
  arcadeBonusRefId,
  arcadeCap,
  arcadeUsageOf,
  arcadeWater,
  arcadeWindowAt,
  arcadeWindowBonusOpen,
  maxScoreFor,
  nextArcadeSlot,
  nextArcadeWindowStart,
  type ArcadeGameId,
  type ArcadeWindowId,
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
  /** Bí mật ký mã ván (JWT_ACCESS_SECRET); bỏ trống thì dùng khoá dev của service. */
  secret?: string;
}

const USER = 'u1';
/** Giá trị `runId` đánh dấu "harness cấp mã hợp lệ theo thời gian ván" cho các ca không bàn về mã ván. */
const AUTO_RUN = 'auto';
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
    findMany: jest.fn(async ({ where }: { where: Parameters<typeof eventMatches>[1] }) =>
      events.filter((e) => eventMatches(e, where)).map((e) => ({ reason: e.reason, refId: e.refId })),
    ),
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
    gameWaterEvent: { findMany: gameWaterEvent.findMany, findUnique: gameWaterEvent.findUnique },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const held: Array<() => void> = [];
      // Như Postgres: tx chỉ hoàn tác phần của chính nó, nên mốc khôi phục là lúc giành được khoá (tx đứng sau không xoá kết quả tx đứng trước).
      let before = snapshot();
      const tx = {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join('?');
          if (sql.includes('FROM "users"')) {
            if (!opts.noLock) {
              held.push(await acquire(values[0] as string));
              before = snapshot();
            }
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
  const svc = new GameArcadeService(
    prisma as unknown as PrismaService,
    config as unknown as SystemConfigService,
    loyalty as unknown as LoyaltyService,
    { get: () => opts.secret } as unknown as ConfigService,
  );
  // Ca cũ chỉ quan tâm điểm và thời điểm: `runId: AUTO_RUN` được thay bằng mã cấp đúng `durationMs` trước lúc báo xong (thời gian đo = thời lượng khai).
  const complete = svc.complete.bind(svc);
  svc.complete = (userId, input, now = new Date()) => {
    if (input.runId !== undefined && input.runId !== AUTO_RUN) return complete(userId, input, now);
    const issuedAt = Number.isFinite(input.durationMs) ? now.getTime() - input.durationMs : now.getTime();
    return complete(userId, { ...input, runId: svc.start(input.gameId, new Date(issuedAt)).runId }, now);
  };
  const reasonOf = (gameId: ArcadeGameId) => (gameId === 'dew_catcher' ? 'ARCADE_DEW_CATCHER' : 'ARCADE_REFILL_RUSH');
  /** `n` lượt cơ sở đã dùng của ngày VN chứa `at`. */
  const seedBase = (gameId: ArcadeGameId, n: number, at: Date) => {
    for (let i = 1; i <= n; i++) events.push({ userId: USER, delta: 5, reason: reasonOf(gameId), refId: arcadeBaseRefId(USER, vnDateKey(at), i), createdAt: at });
  };
  /** Lượt thưởng khung `window` đã dùng của ngày VN chứa `at`. */
  const seedBonus = (gameId: ArcadeGameId, window: ArcadeWindowId, at: Date) => {
    events.push({ userId: USER, delta: 5, reason: reasonOf(gameId), refId: arcadeBonusRefId(USER, vnDateKey(at), window), createdAt: at });
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
    seedBase,
    seedBonus,
    seedScore,
  };
}

const run = (score = 300, durationMs = 40_000) => ({ gameId: 'dew_catcher' as const, score, durationMs, runId: AUTO_RUN });
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

  it('trần điểm theo đường cong RATE × d × min(1, d / nominal): bình phương tới hết thời lượng danh nghĩa rồi tuyến tính', () => {
    expect(ARCADE_MAX_SCORE_PER_SEC).toEqual({ dew_catcher: 160, refill_rush: 60 });
    const dew = (ms: number) => maxScoreFor('dew_catcher', ms);
    expect(dew(5_000)).toBe(100);
    expect(dew(7_500)).toBe(225);
    expect(dew(20_000)).toBe(1_600);
    expect(dew(40_000)).toBe(6_400);
    expect(dew(50_000)).toBe(8_000); // nominal + 10s: tuyến tính 160/s
    const rush = (ms: number) => maxScoreFor('refill_rush', ms);
    expect(rush(5_000)).toBe(34); // 60 × 5 × 5/45 = 33,33 làm tròn lên
    expect(rush(20_000)).toBe(534); // 60 × 20 × 20/45 = 533,33
    expect(rush(45_000)).toBe(2_700);
    expect(rush(55_000)).toBe(3_300);
  });

  it('trần tăng đều theo thời lượng, và làm tròn lên khi lẻ (5.001 ms dew = 100,03 → 101)', () => {
    for (const gameId of ARCADE_GAME_IDS) {
      let last = 0;
      for (let ms = 5_000; ms <= ARCADE_NOMINAL_MS[gameId] + 10_000; ms += 500) {
        const max = maxScoreFor(gameId, ms);
        expect(max).toBeGreaterThanOrEqual(last);
        last = max;
      }
    }
    expect(maxScoreFor('dew_catcher', 5_001)).toBe(101);
  });

  it('ngưỡng thưởng tối thiểu: dew 100, rush 60; ván ngắn nhất hợp lệ của dew vừa đủ ngưỡng, của rush không thể đạt', () => {
    expect(ARCADE_MIN_REWARD_SCORE).toEqual({ dew_catcher: 100, refill_rush: 60 });
    expect(maxScoreFor('dew_catcher', 5_000)).toBeGreaterThanOrEqual(ARCADE_MIN_REWARD_SCORE.dew_catcher);
    expect(maxScoreFor('refill_rush', 5_000)).toBeLessThan(ARCADE_MIN_REWARD_SCORE.refill_rush);
  });
});

describe('lượt thưởng cơ sở và lượt thưởng khung (hàm thuần)', () => {
  const base = (n: number) => Array.from({ length: n }, (_, i) => arcadeBaseRefId('u1', '2026-11-15', i + 1));
  const bonus = (w: ArcadeWindowId) => arcadeBonusRefId('u1', '2026-11-15', w);

  it('refId: cơ sở `user:ngày:n`, thưởng khung `user:ngày:bonus:khung`', () => {
    expect(arcadeBaseRefId('u1', '2026-11-15', 2)).toBe('u1:2026-11-15:2');
    expect(arcadeBonusRefId('u1', '2026-11-15', 'SUONG_SOM')).toBe('u1:2026-11-15:bonus:SUONG_SOM');
  });

  it('usage tách lượt cơ sở và lượt thưởng khung từ refId', () => {
    const u = arcadeUsageOf([...base(3), bonus('MUA_RAO'), null]);
    expect(u.baseUsed).toBe(4);
    expect([...u.bonusUsed]).toEqual(['MUA_RAO']);
    expect(u.total).toBe(5);
  });

  it('cap = 3 + lượt thưởng khung đã dùng + 1 nếu đang trong khung mà lượt của khung đó chưa dùng', () => {
    const none = arcadeUsageOf([]);
    expect(arcadeCap(null, none)).toBe(3);
    expect(arcadeCap('SUONG_SOM', none)).toBe(4);
    const morning = arcadeUsageOf([...base(3), bonus('SUONG_SOM')]);
    expect(arcadeCap(null, morning)).toBe(4);
    expect(arcadeCap('SUONG_SOM', morning)).toBe(4);
    expect(arcadeCap('MUA_RAO', morning)).toBe(5);
    const both = arcadeUsageOf([...base(3), bonus('SUONG_SOM'), bonus('MUA_RAO')]);
    expect(arcadeCap('MUA_RAO', both)).toBe(5);
    expect(arcadeCap(null, both)).toBe(5);
    expect(arcadeWindowBonusOpen('MUA_RAO', morning)).toBe(true);
    expect(arcadeWindowBonusOpen('SUONG_SOM', morning)).toBe(false);
    expect(arcadeWindowBonusOpen(null, none)).toBe(false);
  });

  it('ô lượt kế tiếp: cơ sở trước, hết cơ sở mới tới thưởng khung của khung đang chạy; ngoài khung không có thưởng', () => {
    expect(nextArcadeSlot(null, arcadeUsageOf([]))).toEqual({ kind: 'base', slot: 1 });
    expect(nextArcadeSlot('MUA_RAO', arcadeUsageOf(base(2)))).toEqual({ kind: 'base', slot: 3 });
    expect(nextArcadeSlot('MUA_RAO', arcadeUsageOf(base(3)))).toEqual({ kind: 'bonus', window: 'MUA_RAO' });
    expect(nextArcadeSlot('MUA_RAO', arcadeUsageOf([...base(3), bonus('SUONG_SOM')]))).toEqual({ kind: 'bonus', window: 'MUA_RAO' });
    expect(nextArcadeSlot('MUA_RAO', arcadeUsageOf([...base(3), bonus('MUA_RAO')]))).toBeNull();
    expect(nextArcadeSlot(null, arcadeUsageOf(base(3)))).toBeNull();
    expect(nextArcadeSlot(null, arcadeUsageOf([...base(3), bonus('SUONG_SOM')]))).toBeNull();
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
    await bad({ ...run(100), durationMs: 4_999 });
    await bad({ ...run(100), durationMs: 0 });
    await bad({ ...run(100), durationMs: -40_000 });
    await bad({ ...run(100), durationMs: 50_001 }); // dew: 40s + 10s
    await bad({ gameId: 'refill_rush', score: 10, durationMs: 55_001 }); // rush: 45s + 10s
  });

  it('ranh hợp lệ: đúng 5.000 ms và đúng nominal + 10.000 ms', async () => {
    const a = makeWorld();
    await expect(a.svc.complete(USER, run(100, 5_000), T0)).resolves.toMatchObject({ rewarded: true });
    const b = makeWorld();
    await expect(b.svc.complete(USER, run(100, 50_000), T0)).resolves.toMatchObject({ rewarded: true });
    const c = makeWorld();
    await expect(c.svc.complete(USER, { gameId: 'refill_rush', score: 60, durationMs: 55_000 , runId: AUTO_RUN}, T0)).resolves.toMatchObject({ rewarded: true });
  });

  it('điểm vượt trần theo đường cong của thời lượng đã khai: 5s, 7,5s, 20s, nominal, nominal + 10s', async () => {
    await bad(run(101, 5_000));
    await bad(run(900, 7_500)); // ván tự khai 7,5s mà 900 điểm
    await bad(run(226, 7_500));
    await bad(run(1_601, 20_000));
    await bad(run(6_401, 40_000));
    await bad(run(8_001, 50_000));
    await bad({ gameId: 'refill_rush', score: 35, durationMs: 5_000 });
    await bad({ gameId: 'refill_rush', score: 535, durationMs: 20_000 });
    await bad({ gameId: 'refill_rush', score: 2_701, durationMs: 45_000 });
    await bad({ gameId: 'refill_rush', score: 3_301, durationMs: 55_000 });
    for (const [score, durationMs] of [[100, 5_000], [225, 7_500], [1_600, 20_000], [6_400, 40_000], [8_000, 50_000]] as const) {
      const ok = makeWorld();
      await expect(ok.svc.complete(USER, run(score, durationMs), T0)).resolves.toMatchObject({ bestScore: score });
    }
    for (const [score, durationMs] of [[34, 5_000], [534, 20_000], [2_700, 45_000], [3_300, 55_000]] as const) {
      const ok = makeWorld();
      await expect(ok.svc.complete(USER, { gameId: 'refill_rush', score, durationMs, runId: AUTO_RUN }, T0)).resolves.toMatchObject({ bestScore: score });
    }
  });

  it('điểm âm, điểm hoặc thời lượng không nguyên/NaN, game lạ', async () => {
    await bad({ ...run(-1) });
    await bad({ ...run(10.5) });
    await bad({ ...run(Number.NaN) });
    await bad({ ...run(100), durationMs: 40_000.5 });
    await bad({ ...run(100), durationMs: Number.NaN });
    await bad({ gameId: 'tetris', score: 10, durationMs: 40_000 });
  });

  it('câu lỗi là tiếng Việt thân thiện, không chữ cấm', async () => {
    const w = makeWorld();
    const messages: string[] = [];
    for (const input of [{ ...run(100), durationMs: 1_000 }, { ...run(100), durationMs: 90_000 }, run(9_999)]) {
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
    const res = await w.svc.complete(USER, { gameId: 'refill_rush', score: 550, durationMs: 45_000 , runId: AUTO_RUN}, T0);
    expect(res).toMatchObject({ rewarded: true, waterEarned: 10 });
    expect(w.state.events[0]).toMatchObject({ reason: 'ARCADE_REFILL_RUSH', delta: 10 });
  });

  it('giọt nền đọc từ game.arcade_water_base; giá trị hỏng rơi về mặc định 5, quá biên bị kẹp 50', async () => {
    const a = makeWorld({ cfg: { 'game.arcade_water_base': 7 } });
    await expect(a.svc.complete(USER, run(900), T0)).resolves.toMatchObject({ waterEarned: 12 });
    const b = makeWorld({ cfg: { 'game.arcade_water_base': 'abc' } });
    await expect(b.svc.complete(USER, run(100), T0)).resolves.toMatchObject({ waterEarned: 5 });
    const c = makeWorld({ cfg: { 'game.arcade_water_base': -3 } });
    await expect(c.svc.complete(USER, run(100), T0)).resolves.toMatchObject({ waterEarned: 5 });
    const d = makeWorld({ cfg: { 'game.arcade_water_base': 99_999 } });
    await expect(d.svc.complete(USER, run(100), T0)).resolves.toMatchObject({ waterEarned: 50 });
  });

  it('cộng Điểm Xanh bằng sổ lô STANDARD có hạn, cùng transaction, số dư khớp tổng sổ', async () => {
    const w = makeWorld();
    const res = await w.svc.complete(USER, run(100), T0);
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
    await w.svc.complete(USER, run(100), new Date(T0.getTime() + 60_000));
    expect(w.state.balance).toBe(2);
    expect(w.state.balance).toBe(sumPoints(w.state.points));
    expect(new Set(w.state.points.map((p) => p.refId)).size).toBe(2);
  });

  it('game.arcade_points_per_run = 0 hoặc hỏng thì không cộng điểm và không đọc hạn điểm; quá biên kẹp 10', async () => {
    for (const bad of [0, 'abc', -1, null]) {
      const w = makeWorld({ cfg: { 'game.arcade_points_per_run': bad } });
      await expect(w.svc.complete(USER, run(100), T0)).resolves.toMatchObject({ rewarded: true, pointsEarned: 0 });
      expect(w.state.points).toHaveLength(0);
      expect(w.state.balance).toBe(0);
      expect(w.loyalty.pointsExpiresAt).not.toHaveBeenCalled();
    }
    const big = makeWorld({ cfg: { 'game.arcade_points_per_run': 1_000_000 } });
    await expect(big.svc.complete(USER, run(100), T0)).resolves.toMatchObject({ pointsEarned: 10 });
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
    await w.svc.complete(USER, { gameId: 'refill_rush', score: 100, durationMs: 45_000 , runId: AUTO_RUN}, T0);
    expect(w.state.scores.map((s) => [s.gameId, s.bestScore])).toEqual([
      ['dew_catcher', 300],
      ['refill_rush', 100],
    ]);
  });
});

describe('GameArcadeService.complete: lượt thưởng mỗi ngày VN (3 lượt cơ sở và một lượt riêng cho mỗi khung giờ)', () => {
  const at = (i: number, from: Date = T0) => new Date(from.getTime() + i * 60_000);
  const rush = (score = 100) => ({ gameId: 'refill_rush' as const, score, durationMs: 45_000, runId: AUTO_RUN });

  it('ngoài khung giờ: 3 lượt cơ sở, ván thứ 4 vẫn chơi và phá kỷ lục nhưng không thưởng, không có lượt thưởng khung', async () => {
    const w = makeWorld();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await w.svc.complete(USER, run(100 + i * 100), at(i)));
    expect(results.map((r) => [r.rewarded, r.reason, r.used, r.cap, r.windowBonus])).toEqual([
      [true, null, 1, 3, false],
      [true, null, 2, 3, false],
      [true, null, 3, 3, false],
      [false, 'DAILY_CAP', 3, 3, false],
    ]);
    expect(results[3]).toMatchObject({ waterEarned: 0, pointsEarned: 0, bestScore: 400, isNewBest: true, totalSeeds: 15 });
    expect(w.state.events.map((e) => e.refId)).toEqual([1, 2, 3].map((n) => `${USER}:2026-11-15:${n}`));
    expect(w.state.points).toHaveLength(3);
    expect(w.state.scores[0]).toMatchObject({ bestScore: 400, plays: 4 });
    expect(w.state.balance).toBe(sumPoints(w.state.points));
  });

  it('trong khung sáng: 3 lượt cơ sở rồi lượt thưởng khung (tổng 4), ván thứ 5 hết lượt', async () => {
    const w = makeWorld();
    const start = vn('07:00:00');
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await w.svc.complete(USER, run(100), at(i, start)));
    expect(results.map((r) => [r.rewarded, r.reason, r.used, r.cap, r.window, r.windowBonus])).toEqual([
      [true, null, 1, 4, 'SUONG_SOM', true],
      [true, null, 2, 4, 'SUONG_SOM', true],
      [true, null, 3, 4, 'SUONG_SOM', true],
      [true, null, 4, 4, 'SUONG_SOM', true], // ăn lượt thưởng khung; windowBonus phản ánh lúc xong, trước khi tiêu
      [false, 'DAILY_CAP', 4, 4, 'SUONG_SOM', false],
    ]);
    expect(w.state.events.map((e) => e.refId)).toEqual([
      `${USER}:2026-11-15:1`,
      `${USER}:2026-11-15:2`,
      `${USER}:2026-11-15:3`,
      `${USER}:2026-11-15:bonus:SUONG_SOM`,
    ]);
    expect(w.state.points.map((p) => p.refId)).toEqual(w.state.events.map((e) => e.refId));
    expect(w.state.balance).toBe(sumPoints(w.state.points));
  });

  it('sáng dùng đủ 3 + lượt thưởng sáng = 4 rồi tối vẫn nhận thêm 1 (tổng 5), rồi hết lượt', async () => {
    const w = makeWorld();
    w.seedBase('dew_catcher', 3, vn('06:40:00'));
    w.seedBonus('dew_catcher', 'SUONG_SOM', vn('06:45:00'));
    const noon = await w.svc.complete(USER, run(100), vn('12:00:00'));
    expect(noon).toMatchObject({ rewarded: false, reason: 'DAILY_CAP', used: 4, cap: 4, window: null, windowBonus: false });
    const evening = await w.svc.complete(USER, run(100), vn('20:00:00'));
    expect(evening).toMatchObject({ rewarded: true, reason: null, used: 5, cap: 5, window: 'MUA_RAO', windowBonus: true });
    expect(w.state.events.at(-1)!.refId).toBe(`${USER}:2026-11-15:bonus:MUA_RAO`);
    const after = await w.svc.complete(USER, run(100), vn('20:05:00'));
    expect(after).toMatchObject({ rewarded: false, reason: 'DAILY_CAP', used: 5, cap: 5, windowBonus: false });
    expect(w.state.events).toHaveLength(5);
  });

  it('dùng hết buổi sáng không làm mất lượt khung tối, và ngược lại lượt khung tối không phụ thuộc lượt sáng', async () => {
    const w = makeWorld();
    w.seedBase('dew_catcher', 3, vn('06:40:00')); // sáng chỉ dùng lượt cơ sở, chưa ăn lượt thưởng sáng
    await expect(w.svc.complete(USER, run(100), vn('19:30:00'))).resolves.toMatchObject({ rewarded: false, reason: 'DAILY_CAP', used: 3, cap: 3 });
    await expect(w.svc.complete(USER, run(100), vn('20:00:00'))).resolves.toMatchObject({ rewarded: true, used: 4, cap: 4, windowBonus: true });
    await expect(w.svc.complete(USER, run(100), vn('21:00:00'))).resolves.toMatchObject({ rewarded: false, reason: 'DAILY_CAP', used: 4, cap: 4 });
  });

  it('ván trong khung dùng lượt cơ sở trước: còn lượt cơ sở thì lượt thưởng khung được giữ lại cho ván sau', async () => {
    const w = makeWorld();
    w.seedBase('dew_catcher', 2, vn('00:30:00'));
    const first = await w.svc.complete(USER, run(100), vn('20:00:00'));
    const second = await w.svc.complete(USER, run(100), vn('20:01:00'));
    const third = await w.svc.complete(USER, run(100), vn('20:02:00'));
    expect([first, second, third].map((r) => [r.rewarded, r.used, r.cap])).toEqual([
      [true, 3, 4],
      [true, 4, 4],
      [false, 4, 4],
    ]);
    expect(w.state.events.map((e) => e.refId).slice(2)).toEqual([`${USER}:2026-11-15:3`, `${USER}:2026-11-15:bonus:MUA_RAO`]);
  });

  // Đã dùng 3 lượt cơ sở; ván hoàn thành đúng ranh quyết định có lượt thưởng khung hay không.
  const boundaries: [string, boolean, ArcadeWindowId | null][] = [
    ['06:29:59', false, null],
    ['06:30:00', true, 'SUONG_SOM'],
    ['08:59:59', true, 'SUONG_SOM'],
    ['09:00:00', false, null],
    ['19:59:59', false, null],
    ['20:00:00', true, 'MUA_RAO'],
    ['21:59:59', true, 'MUA_RAO'],
    ['22:00:00', false, null],
  ];
  it.each(boundaries)('đã dùng 3 lượt cơ sở, hoàn thành lúc %s giờ VN: có lượt thưởng khung = %s', async (hms, rewarded, window) => {
    const w = makeWorld();
    w.seedBase('dew_catcher', 3, vn('00:30:00'));
    const res = await w.svc.complete(USER, run(100), vn(hms));
    expect(res).toMatchObject({
      rewarded,
      window,
      windowBonus: window !== null,
      cap: window ? 4 : 3,
      used: rewarded ? 4 : 3,
      reason: rewarded ? null : 'DAILY_CAP',
      waterEarned: rewarded ? 5 : 0,
    });
    expect(w.state.events).toHaveLength(rewarded ? 4 : 3);
    if (window) expect(w.state.events.at(-1)!.refId).toBe(`${USER}:2026-11-15:bonus:${window}`);
  });

  it('đã dùng lượt thưởng của khung đó rồi thì ván sau trong cùng khung hết lượt, khung kia vẫn còn', async () => {
    const w = makeWorld();
    w.seedBase('dew_catcher', 3, vn('00:30:00'));
    w.seedBonus('dew_catcher', 'SUONG_SOM', vn('06:45:00'));
    await expect(w.svc.complete(USER, run(100), vn('08:59:59'))).resolves.toMatchObject({ rewarded: false, reason: 'DAILY_CAP', used: 4, cap: 4, windowBonus: false });
    await expect(w.svc.complete(USER, run(100), vn('20:00:00'))).resolves.toMatchObject({ rewarded: true, used: 5, cap: 5, windowBonus: true });
  });

  it('mỗi game một bộ lượt riêng, kể cả lượt thưởng khung', async () => {
    const w = makeWorld();
    w.seedBase('dew_catcher', 3, vn('00:30:00'));
    w.seedBonus('dew_catcher', 'SUONG_SOM', vn('06:45:00'));
    await expect(w.svc.complete(USER, run(100), vn('07:30:00'))).resolves.toMatchObject({ rewarded: false, reason: 'DAILY_CAP' });
    await expect(w.svc.complete(USER, rush(), vn('07:30:00'))).resolves.toMatchObject({ rewarded: true, used: 1, cap: 4, windowBonus: true });
    expect(w.state.events.at(-1)).toMatchObject({ reason: 'ARCADE_REFILL_RUSH', refId: `${USER}:2026-11-15:1` });
  });

  it('sang ngày VN mới (00:00 giờ VN): lượt cơ sở và lượt thưởng khung hôm qua không tính', async () => {
    const w = makeWorld();
    const yesterday = vn('23:59:59', '2026-11-14');
    w.seedBase('dew_catcher', 3, yesterday);
    w.seedBonus('dew_catcher', 'MUA_RAO', yesterday);
    const res = await w.svc.complete(USER, run(100), vn('00:00:00'));
    expect(res).toMatchObject({ rewarded: true, used: 1, cap: 3, window: null });
    expect(w.state.events.at(-1)!.refId).toBe(`${USER}:2026-11-15:1`);
    expect(startOfVnDay(vn('00:00:00')).toISOString()).toBe(vn('00:00:00').toISOString());
  });

  it('lượt thưởng khung tối hôm qua không chặn lượt thưởng khung tối hôm nay (refId theo ngày)', async () => {
    const w = makeWorld();
    const yesterday = vn('21:00:00', '2026-11-14');
    w.seedBase('dew_catcher', 3, yesterday);
    w.seedBonus('dew_catcher', 'MUA_RAO', yesterday);
    w.seedBase('dew_catcher', 3, vn('00:10:00'));
    await expect(w.svc.complete(USER, run(100), vn('20:00:00'))).resolves.toMatchObject({ rewarded: true, used: 4, cap: 4 });
    expect(w.state.events.at(-1)!.refId).toBe(`${USER}:2026-11-15:bonus:MUA_RAO`);
  });

  it('hai ván hoàn thành song song lúc còn đúng 1 lượt cơ sở (ngoài khung): chỉ một ván ăn lượt', async () => {
    const w = makeWorld();
    w.seedBase('dew_catcher', 2, vn('00:30:00'));
    const [a, b] = await Promise.all([w.svc.complete(USER, run(100), T0), w.svc.complete(USER, run(100), at(1))]);
    expect([a.rewarded, b.rewarded].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.rewarded)!.reason).toBe('DAILY_CAP');
    expect(w.state.events).toHaveLength(3);
    expect(w.state.points).toHaveLength(1);
    expect(w.state.profile!.totalSeeds).toBe(5);
    expect(w.state.balance).toBe(sumPoints(w.state.points));
  });

  it('hai ván song song lúc hết lượt cơ sở trong khung: chỉ một ván ăn lượt thưởng khung', async () => {
    const w = makeWorld();
    w.seedBase('dew_catcher', 3, vn('00:30:00'));
    const start = vn('07:00:00');
    const [a, b] = await Promise.all([w.svc.complete(USER, run(100), start), w.svc.complete(USER, run(100), at(1, start))]);
    expect([a.rewarded, b.rewarded].sort()).toEqual([false, true]);
    expect(b).toMatchObject({ reason: 'DAILY_CAP', used: 4 });
    expect(w.state.events.filter((e) => e.refId!.endsWith(':bonus:SUONG_SOM'))).toHaveLength(1);
    expect(w.state.points).toHaveLength(1);
    expect(w.state.balance).toBe(sumPoints(w.state.points));
  });

  it('hai ván cùng giờ hoàn thành song song: ván thứ hai bắt đầu trước khi ván thứ nhất xong nên 409, chỉ một lượt bị tiêu', async () => {
    const w = makeWorld();
    const [a, b] = await Promise.allSettled([w.svc.complete(USER, run(100), T0), w.svc.complete(USER, run(100), T0)]);
    expect(a).toMatchObject({ status: 'fulfilled', value: { reason: null } });
    expect(b).toMatchObject({ status: 'rejected' });
    expect((b as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(w.state.events).toHaveLength(1);
    expect(w.state.scores[0]!.plays).toBe(1);
  });

  it('backstop unique ô cơ sở: hai tx cùng đọc "còn chỗ" (không khoá) vẫn không vượt trần, tx thua thành DAILY_CAP mà không mất kỷ lục', async () => {
    const w = makeWorld({ noLock: true });
    w.seedBase('dew_catcher', 2, vn('00:30:00'));
    w.seedScore('dew_catcher');
    const [a, b] = await Promise.all([w.svc.complete(USER, run(100), T0), w.svc.complete(USER, run(700), at(1))]);
    expect([a.rewarded, b.rewarded].filter(Boolean)).toHaveLength(1);
    const loser = [a, b].find((r) => !r.rewarded)!;
    expect(loser).toMatchObject({ reason: 'DAILY_CAP', used: 3 });
    expect(w.state.events).toHaveLength(3);
    expect(w.state.points).toHaveLength(1);
    expect(w.state.scores[0]!.plays).toBe(2);
  });

  it('backstop unique lượt thưởng khung: hai tx không khoá cùng muốn lượt thưởng khung, chỉ một dòng được ghi', async () => {
    const w = makeWorld({ noLock: true });
    w.seedBase('dew_catcher', 3, vn('00:30:00'));
    w.seedScore('dew_catcher');
    const start = vn('07:00:00');
    const [a, b] = await Promise.all([w.svc.complete(USER, run(100), start), w.svc.complete(USER, run(100), at(1, start))]);
    expect([a.rewarded, b.rewarded].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((r) => !r.rewarded)).toMatchObject({ reason: 'DAILY_CAP', used: 4, cap: 4 });
    expect(w.state.events).toHaveLength(4);
    expect(w.state.points).toHaveLength(1);
  });
});

describe('GameArcadeService.complete: ván dưới ngưỡng thưởng (LOW_SCORE)', () => {
  it.each([
    ['dew_catcher', 99, 100],
    ['refill_rush', 59, 60],
  ] as const)('%s: %i điểm không thưởng và không tiêu lượt, %i điểm thưởng bình thường', async (gameId, low, enough) => {
    const durationMs = ARCADE_NOMINAL_MS[gameId];
    const w = makeWorld();
    const res = await w.svc.complete(USER, { gameId, score: low, durationMs, runId: AUTO_RUN }, T0);
    expect(res).toMatchObject({ rewarded: false, reason: 'LOW_SCORE', waterEarned: 0, pointsEarned: 0, used: 0, cap: 3, bestScore: low, isNewBest: true });
    expect(w.state.events).toHaveLength(0);
    expect(w.state.points).toHaveLength(0);
    expect(w.state.profile!.totalSeeds).toBe(0);
    expect(w.state.scores[0]).toMatchObject({ gameId, bestScore: low, plays: 1, lastRunAt: T0 });

    const next = await w.svc.complete(USER, { gameId, score: enough, durationMs, runId: AUTO_RUN }, new Date(T0.getTime() + durationMs + 1_000));
    expect(next).toMatchObject({ rewarded: true, reason: null, used: 1 });
    expect(w.state.scores[0]).toMatchObject({ bestScore: enough, plays: 2 });
  });

  it('vẫn cập nhật kỷ lục, số ván và lastRunAt (nên ván bắt đầu trước lúc ván điểm thấp xong bị 409)', async () => {
    const w = makeWorld();
    await w.svc.complete(USER, run(50), T0);
    await w.svc.complete(USER, run(80), new Date(T0.getTime() + 41_000));
    expect(w.state.scores[0]).toMatchObject({ bestScore: 80, plays: 2, lastRunAt: new Date(T0.getTime() + 41_000) });
    await expect(w.svc.complete(USER, run(300), new Date(T0.getTime() + 50_000))).rejects.toBeInstanceOf(ConflictException);
  });

  it('không tiêu lượt: nhiều ván điểm thấp rồi ván đủ điểm vẫn nhận lượt thứ nhất, và không cần hồ sơ game', async () => {
    const w = makeWorld({ noProfile: true });
    for (let i = 0; i < 5; i++) await expect(w.svc.complete(USER, run(50), new Date(T0.getTime() + i * 41_000))).resolves.toMatchObject({ reason: 'LOW_SCORE', used: 0 });
    expect(w.state.profile).toBeUndefined();
    expect(w.loyalty.pointsExpiresAt).not.toHaveBeenCalled();
    await expect(w.svc.complete(USER, run(100), new Date(T0.getTime() + 5 * 41_000))).resolves.toMatchObject({ rewarded: true, used: 1 });
  });
});

describe('GameArcadeService.complete: thứ tự lý do không thưởng', () => {
  // DISABLED > NOT_REAL_USER > LOW_SCORE > DAILY_CAP. Ván nào cũng ghi kỷ lục, số ván và lastRunAt.
  const secondRun = new Date(T0.getTime() + 41_000);

  it('DISABLED thắng mọi lý do còn lại', async () => {
    const w = makeWorld({ user: { zaloId: 'guest_h_abc', phone: null } });
    await w.svc.complete(USER, run(300), T0);
    w.cfg['game.arcade_enabled'] = false;
    await expect(w.svc.complete(USER, run(10), secondRun)).resolves.toMatchObject({ reason: 'DISABLED' });
    expect(w.state.scores[0]).toMatchObject({ plays: 2, lastRunAt: secondRun });
  });

  it('NOT_REAL_USER thắng LOW_SCORE và DAILY_CAP', async () => {
    const w = makeWorld({ user: { zaloId: 'guest_h_abc', phone: null } });
    await w.svc.complete(USER, run(300), T0);
    await expect(w.svc.complete(USER, run(10), secondRun)).resolves.toMatchObject({ reason: 'NOT_REAL_USER' });
    const lowCap = makeWorld({ user: { zaloId: 'guest_h_abc', phone: null } });
    await expect(lowCap.svc.complete(USER, run(10), T0)).resolves.toMatchObject({ reason: 'NOT_REAL_USER', bestScore: 10 });
  });

  it('LOW_SCORE thắng DAILY_CAP: hết lượt mà điểm thấp thì nói điểm thấp', async () => {
    const w = makeWorld();
    w.seedBase('dew_catcher', 3, vn('00:30:00'));
    await expect(w.svc.complete(USER, run(99), T0)).resolves.toMatchObject({ reason: 'LOW_SCORE', used: 3, cap: 3 });
    await expect(w.svc.complete(USER, run(300), new Date(T0.getTime() + 41_000))).resolves.toMatchObject({ reason: 'DAILY_CAP' });
  });
});

describe('GameArcadeService.start và mã ván (runId)', () => {
  const SECRET = 'a-very-long-test-secret-for-arcade-runs';
  const startAt = (w: ReturnType<typeof makeWorld>, at: Date, gameId: ArcadeGameId = 'dew_catcher') => w.svc.start(gameId, at).runId;
  const body = (runId: string, score = 100, durationMs = 40_000) => ({ gameId: 'dew_catcher' as const, score, durationMs, runId });
  const untouched = (w: ReturnType<typeof makeWorld>) => {
    expect(w.prisma.$transaction).not.toHaveBeenCalled();
    expect(w.state.events).toHaveLength(0);
    expect(w.state.scores).toHaveLength(0);
  };

  it('start cấp mã kèm giờ bắt đầu và hạn đúng 10 phút', () => {
    const r = makeWorld().svc.start('refill_rush', T0);
    expect(r.startedAt).toBe(T0.toISOString());
    expect(r.expiresAt).toBe(new Date(T0.getTime() + ARCADE_RUN_TTL_MS).toISOString());
    expect(r.runId).toMatch(/^r1\.refill_rush\.\d+\./);
    expect(makeWorld().svc.start('refill_rush', T0).runId).not.toBe(r.runId);
  });

  it('thiếu mã, mã bịa, mã bị sửa một ký tự hoặc ký bằng bí mật khác: 400 và không chạm DB', async () => {
    const w = makeWorld({ secret: SECRET });
    const good = startAt(w, T0);
    const forged = makeWorld({ secret: 'another-secret-another-secret-123456' }).svc.start('dew_catcher', T0).runId;
    const raw = (input: unknown) => GameArcadeService.prototype.complete.call(w.svc, USER, input as never, new Date(T0.getTime() + 40_000));
    for (const runId of [undefined, null, 7, '', 'abc', 'r1.dew_catcher.1.n.s', good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A'), forged]) {
      await expect(raw({ ...body('x'), runId })).rejects.toBeInstanceOf(BadRequestException);
    }
    untouched(w);
  });

  it('mã của game này không dùng cho game khác, và đổi game trong mã làm hỏng chữ ký', async () => {
    const w = makeWorld({ secret: SECRET });
    const dew = startAt(w, T0, 'dew_catcher');
    const done = new Date(T0.getTime() + 45_000);
    await expect(w.svc.complete(USER, { gameId: 'refill_rush', score: 60, durationMs: 45_000, runId: dew }, done)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      w.svc.complete(USER, { gameId: 'refill_rush', score: 60, durationMs: 45_000, runId: dew.replace('dew_catcher', 'refill_rush') }, done),
    ).rejects.toBeInstanceOf(BadRequestException);
    untouched(w);
  });

  it('bắn kết quả ngay sau start (0,1 giây) với ván tự khai 40 giây: 400, không thưởng, không ghi kỷ lục', async () => {
    const w = makeWorld({ secret: SECRET });
    const runId = startAt(w, T0);
    await expect(w.svc.complete(USER, body(runId, 1_600, 40_000), new Date(T0.getTime() + 100))).rejects.toBeInstanceOf(BadRequestException);
    untouched(w);
  });

  it('ranh thời gian đo: durationMs đúng bằng thời gian đo cộng slack hợp lệ, hơn 1 ms là 400', async () => {
    const dur = 20_000;
    const at = new Date(T0.getTime() + dur - ARCADE_RUN_SLACK_MS);
    const ok = makeWorld({ secret: SECRET });
    await expect(ok.svc.complete(USER, body(startAt(ok, T0), 100, dur), at)).resolves.toMatchObject({ rewarded: true });
    const fast = makeWorld({ secret: SECRET });
    await expect(fast.svc.complete(USER, body(startAt(fast, T0), 100, dur), new Date(at.getTime() - 1))).rejects.toBeInstanceOf(BadRequestException);
    untouched(fast);
  });

  it('tạm dừng làm ván kéo dài hơn thời lượng chơi vẫn hợp lệ trong hạn 10 phút; quá hạn 1 ms là 400', async () => {
    const ok = makeWorld({ secret: SECRET });
    await expect(ok.svc.complete(USER, body(startAt(ok, T0), 100, 40_000), new Date(T0.getTime() + ARCADE_RUN_TTL_MS))).resolves.toMatchObject({ rewarded: true });
    const late = makeWorld({ secret: SECRET });
    await expect(late.svc.complete(USER, body(startAt(late, T0), 100, 40_000), new Date(T0.getTime() + ARCADE_RUN_TTL_MS + 1))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    untouched(late);
  });

  it('phát lại cùng một mã: lần hai 409, sổ nước, điểm và kỷ lục không đổi', async () => {
    const w = makeWorld({ secret: SECRET });
    const runId = startAt(w, T0);
    const done = new Date(T0.getTime() + 40_000);
    await expect(w.svc.complete(USER, body(runId, 300), done)).resolves.toMatchObject({ rewarded: true, used: 1 });
    const replay = await w.svc.complete(USER, body(runId, 900), new Date(done.getTime() + 5_000)).catch((e: unknown) => e);
    expect(replay).toBeInstanceOf(ConflictException);
    expect((replay as ConflictException).getResponse()).toMatchObject({ statusCode: 409, code: 'ARCADE_RUN_USED' });
    expect(w.state.events).toHaveLength(1);
    expect(w.state.points).toHaveLength(1);
    expect(w.state.scores[0]).toMatchObject({ bestScore: 300, plays: 1, lastRunAt: done });
  });

  it('mã đã dùng ở ván không thưởng (LOW_SCORE) cũng không dùng lại được', async () => {
    const w = makeWorld({ secret: SECRET });
    const runId = startAt(w, T0);
    const done = new Date(T0.getTime() + 40_000);
    await expect(w.svc.complete(USER, body(runId, 10), done)).resolves.toMatchObject({ reason: 'LOW_SCORE' });
    await expect(w.svc.complete(USER, body(runId, 10), done)).rejects.toBeInstanceOf(ConflictException);
    expect(w.state.scores[0]).toMatchObject({ plays: 1 });
  });

  it('hai lần gửi song song cùng một mã: đúng một lần thắng, lần kia 409, chỉ một dòng thưởng', async () => {
    const w = makeWorld({ secret: SECRET });
    const runId = startAt(w, T0);
    const done = new Date(T0.getTime() + 40_000);
    const settled = await Promise.allSettled([w.svc.complete(USER, body(runId, 300), done), w.svc.complete(USER, body(runId, 300), done)]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictException);
    expect(w.state.events).toHaveLength(1);
    expect(w.state.scores[0]).toMatchObject({ plays: 1 });
  });

  it('mã cấp trước lúc ván trước kết thúc (hai ván chồng nhau) 409, kể cả khi mã chưa từng dùng', async () => {
    const w = makeWorld({ secret: SECRET });
    const first = startAt(w, T0);
    const second = startAt(w, new Date(T0.getTime() + 5_000));
    await w.svc.complete(USER, body(first, 100), new Date(T0.getTime() + 40_000));
    await expect(w.svc.complete(USER, body(second, 100), new Date(T0.getTime() + 45_000))).rejects.toBeInstanceOf(ConflictException);
    expect(w.state.scores[0]).toMatchObject({ plays: 1 });
  });

  it('ván nối tiếp bình thường (mã mới cấp sau khi ván trước xong) vẫn được thưởng', async () => {
    const w = makeWorld({ secret: SECRET });
    const done1 = new Date(T0.getTime() + 40_000);
    await w.svc.complete(USER, body(startAt(w, T0)), done1);
    const next = new Date(done1.getTime() + 1);
    await expect(w.svc.complete(USER, body(startAt(w, next)), new Date(next.getTime() + 40_000))).resolves.toMatchObject({ rewarded: true, used: 2 });
  });

  it('mã đã dùng tính riêng từng game: ván game khác không bị coi là phát lại', async () => {
    const w = makeWorld({ secret: SECRET });
    await w.svc.complete(USER, body(startAt(w, T0)), new Date(T0.getTime() + 40_000));
    const rush = startAt(w, new Date(T0.getTime() + 1_000), 'refill_rush');
    await expect(
      w.svc.complete(USER, { gameId: 'refill_rush', score: 100, durationMs: 40_000, runId: rush }, new Date(T0.getTime() + 41_000)),
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
    await w.svc.complete(USER, { gameId: 'refill_rush', score: 200, durationMs: 45_000 , runId: AUTO_RUN}, vn('07:03:00'));
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
    w.seedBase('dew_catcher', 3, vn('10:00:00', '2026-11-14'));
    w.seedBonus('dew_catcher', 'MUA_RAO', vn('21:00:00', '2026-11-14'));
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

  it('used là cơ sở cộng thưởng khung; cap = 3 + thưởng khung đã dùng + 1 nếu khung đang chạy còn lượt (tính riêng từng game)', async () => {
    const w = makeWorld();
    w.seedBase('dew_catcher', 3, vn('06:40:00'));
    w.seedBonus('dew_catcher', 'SUONG_SOM', vn('06:45:00'));
    const sang = await w.svc.status(USER, vn('08:00:00'));
    expect(sang.games).toEqual({
      dew_catcher: { bestScore: 0, plays: 0, used: 4, cap: 4 },
      refill_rush: { bestScore: 0, plays: 0, used: 0, cap: 4 },
    });
    expect(sang).toMatchObject({ window: 'SUONG_SOM', windowBonus: true }); // rush còn lượt thưởng sáng
    const trua = await w.svc.status(USER, vn('12:00:00'));
    expect(trua.games.dew_catcher).toMatchObject({ used: 4, cap: 4 });
    expect(trua.games.refill_rush).toMatchObject({ used: 0, cap: 3 });
    expect(trua).toMatchObject({ window: null, windowBonus: false });
    const toi = await w.svc.status(USER, vn('20:30:00'));
    expect(toi.games.dew_catcher).toMatchObject({ used: 4, cap: 5 });
    expect(toi.games.refill_rush).toMatchObject({ used: 0, cap: 4 });
    expect(toi).toMatchObject({ window: 'MUA_RAO', windowBonus: true });
  });

  it('windowBonus ở status là false khi mọi game đã dùng lượt thưởng của khung đang chạy', async () => {
    const w = makeWorld();
    for (const gameId of ARCADE_GAME_IDS) {
      w.seedBase(gameId, 3, vn('06:40:00'));
      w.seedBonus(gameId, 'SUONG_SOM', vn('06:45:00'));
    }
    await expect(w.svc.status(USER, vn('08:00:00'))).resolves.toMatchObject({ window: 'SUONG_SOM', windowBonus: false });
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
