import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { buildGameRows, NoelMetricsService } from './noel-metrics.service';

type Rows = Record<string, unknown[]>;

/** `$queryRaw` giả: nhận diện câu truy vấn qua tên bảng/cột đặc trưng, không phụ thuộc thứ tự gọi. */
function fakePrisma(rows: Rows = {}) {
  const seen: Array<{ sql: string; values: unknown[] }> = [];
  const route = (sql: string): unknown[] => {
    if (sql.includes('set_config')) return [{}];
    if (sql.includes('game_global_daily')) return rows.global ?? [{ max_points: 0 }];
    if (sql.includes('game_water_events')) return rows.arcadeWater ?? [{ runs: 0, water: 0 }];
    if (sql.includes('game_daily_ledger')) return rows.ledger ?? [{ users: 0, rounds: 0, water: 0, points: 0, max_w: 0, max_p: 0 }];
    if (sql.includes('game_play_rounds')) return rows.mini ?? [];
    if (sql.includes(`'arcade_run'`)) return rows.arcade ?? [];
    if (sql.includes('WITH ev AS')) return rows.retention ?? [];
    if (sql.includes(`'noel_action'`)) return rows.actions ?? [];
    if (sql.includes('FILTER (WHERE c."streakDays"')) return rows.claimTotal ?? [{ users: 0, s3: 0, s7: 0 }];
    if (sql.includes('t.opened')) return rows.adventDone ?? [{ opened_any: 0, completed: 0 }];
    if (sql.includes('count(*) AS claims')) return rows.claimDay ?? [];
    if (sql.includes('count(*) AS users')) return rows.adventDay ?? [];
    throw new Error(`câu truy vấn lạ: ${sql}`);
  };
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      seen.push({ sql, values });
      return route(sql);
    }),
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } as unknown as PrismaService;
  return { prisma, tx, seen };
}

function fakeConfig(values: Record<string, unknown> = {}): SystemConfigService {
  return { get: jest.fn(async (key: string, fallback: unknown) => (key in values ? values[key] : fallback)) } as unknown as SystemConfigService;
}

// 20/12/2026 10:00 giờ VN
const NOW = new Date('2026-12-20T03:00:00Z');

describe('NoelMetricsService — trạng thái rỗng', () => {
  it('chưa có dữ liệu: mọi số 0, tỉ lệ null, vẫn đủ ngày, đủ 6 món, đủ 4 game, đủ 12 ô lịch', async () => {
    const { prisma } = fakePrisma();
    const svc = new NoelMetricsService(prisma, fakeConfig({ 'theme.seasonal': 'christmas' }));
    const out = await svc.getSnapshot(7, NOW);

    expect(out.seasonalTheme).toBe('christmas');
    expect(out.days).toBe(7);
    expect(out.fromDayKey).toBe('2026-12-14');
    expect(out.toDayKey).toBe('2026-12-20');
    expect(out.claims.perDay).toHaveLength(7);
    expect(out.claims.perDay.every((d) => d.count === 0)).toBe(true);
    expect(out.claims).toMatchObject({ users: 0, claims: 0, reachedStreak3: 0, reachedStreak7: 0 });

    expect(out.advent.phase).toBe('during');
    expect(out.advent.daysElapsed).toBe(7);
    expect(out.advent.requiredDays).toBe(6);
    expect(out.advent.opensByDay).toHaveLength(12);
    expect(out.advent.openedAny).toBe(0);
    expect(out.advent.completed).toBe(0);
    expect(out.advent.completionPct).toBeNull();

    expect(out.ornaments.map((o) => o.slot)).toEqual(['star', 'lights', 'baubles', 'gifts', 'reindeer', 'wreath']);
    expect(out.ornaments.every((o) => o.unlock.taps === 0 && o.hang.taps === 0 && o.remove.users === 0)).toBe(true);
    expect(out.share).toEqual({ users: 0, taps: 0 });
    expect(out.snow.offSharePct).toBeNull();

    expect(out.games.map((g) => g.game)).toEqual(['dew_catcher', 'refill_rush', 'eco_merge', 'green_conveyor']);
    expect(out.games.every((g) => g.plays === 0 && g.avgScore === null)).toBe(true);

    expect(out.retention.noel).toEqual({ userDays: 0, returned: 0, ratePct: null });
    expect(out.retention.other).toEqual({ userDays: 0, returned: 0, ratePct: null });
    expect(out.economy.current.miniWater).toBe(0);
    expect(out.economy.previous.toDayKey).toBe('2026-12-13');
  });

  it('trước 14/12: lịch chưa tới ngày, completed null, không chạy câu truy vấn lịch', async () => {
    const { prisma, seen } = fakePrisma();
    const out = await new NoelMetricsService(prisma, fakeConfig()).getSnapshot(7, new Date('2026-12-10T03:00:00Z'));
    expect(out.advent).toMatchObject({ phase: 'before', daysElapsed: 0, completed: null, completionPct: null, openedAny: 0 });
    expect(out.advent.opensByDay.every((d) => d.users === 0)).toBe(true);
    expect(seen.some((s) => s.sql.includes('t.opened'))).toBe(false);
  });

  it('cờ theme.seasonal chưa đặt: trả "none" (tab ẩn ở web)', async () => {
    const { prisma } = fakePrisma();
    expect((await new NoelMetricsService(prisma, fakeConfig()).getSnapshot(1, NOW)).seasonalTheme).toBe('none');
  });

  it('cờ theme.seasonal giá trị lạ: về "none"', async () => {
    const { prisma } = fakePrisma();
    expect((await new NoelMetricsService(prisma, fakeConfig({ 'theme.seasonal': 'halloween' })).getSnapshot(1, NOW)).seasonalTheme).toBe('none');
  });
});

describe('NoelMetricsService — ghép số liệu', () => {
  it('điền nhận quà theo ngày (bigint từ Postgres), ngày không có dòng là 0', async () => {
    const { prisma } = fakePrisma({
      claimDay: [
        { day_key: '2026-12-14', claims: 3n },
        { day_key: '2026-12-20', claims: 5n },
        { day_key: '2026-12-01', claims: 99n },
      ],
      claimTotal: [{ users: 7n, s3: 4n, s7: 1n }],
    });
    const out = await new NoelMetricsService(prisma, fakeConfig()).getSnapshot(7, NOW);
    expect(out.claims.perDay.map((d) => d.count)).toEqual([3, 0, 0, 0, 0, 0, 5]);
    expect(out.claims.claims).toBe(8);
    expect(out.claims.users).toBe(7);
    expect(out.claims.reachedStreak3).toBe(4);
    expect(out.claims.reachedStreak7).toBe(1);
  });

  it('lịch quà: ô theo ngày, tỉ lệ hoàn thành = đủ mọi ô tới hôm qua / mở ít nhất một ô', async () => {
    const { prisma } = fakePrisma({
      adventDay: [
        { day_key: '2026-12-14', users: 10n },
        { day_key: '2026-12-15', users: 8n },
      ],
      adventDone: [{ opened_any: 12n, completed: 3n }],
    });
    const out = await new NoelMetricsService(prisma, fakeConfig()).getSnapshot(7, NOW);
    expect(out.advent.opensByDay[0]).toEqual({ day: 1, dayKey: '2026-12-14', users: 10 });
    expect(out.advent.opensByDay[1]).toEqual({ day: 2, dayKey: '2026-12-15', users: 8 });
    expect(out.advent.opensByDay[2]).toMatchObject({ day: 3, users: 0 });
    expect(out.advent.openedAny).toBe(12);
    expect(out.advent.completed).toBe(3);
    expect(out.advent.completionPct).toBe(25);
  });

  it('lịch quà: tính hoàn thành tới hôm qua; ngày đầu chưa tính (null); sau 25/12 đủ 12 ô', async () => {
    const run = async (iso: string) => {
      const { prisma } = fakePrisma({ adventDone: [{ opened_any: 4n, completed: 2n }] });
      return (await new NoelMetricsService(prisma, fakeConfig()).getSnapshot(7, new Date(iso))).advent;
    };
    expect(await run('2026-12-14T03:00:00Z')).toMatchObject({ phase: 'during', daysElapsed: 1, requiredDays: 0, openedAny: 4, completed: null, completionPct: null });
    expect(await run('2026-12-20T03:00:00Z')).toMatchObject({ phase: 'during', daysElapsed: 7, requiredDays: 6, completed: 2, completionPct: 50 });
    expect(await run('2026-12-25T03:00:00Z')).toMatchObject({ phase: 'during', daysElapsed: 12, requiredDays: 11 });
    expect(await run('2026-12-26T03:00:00Z')).toMatchObject({ phase: 'after', daysElapsed: 12, requiredDays: 12, completed: 2 });
  });

  it('thao tác Noel: món theo slot, chia sẻ, tuyết và tỉ lệ tắt tuyết theo lượt bấm', async () => {
    const { prisma } = fakePrisma({
      actions: [
        { action: 'ornament_unlock', slot: 'baubles', taps: 3n, users: 3n },
        { action: 'ornament_on', slot: 'baubles', taps: 6n, users: 4n },
        { action: 'ornament_off', slot: 'baubles', taps: 1n, users: 1n },
        { action: 'ornament_on', slot: 'wreath', taps: 2n, users: 2n },
        { action: 'share_tap', slot: null, taps: 9n, users: 5n },
        { action: 'snow_on', slot: null, taps: 3n, users: 3n },
        { action: 'snow_off', slot: null, taps: 1n, users: 1n },
      ],
    });
    const out = await new NoelMetricsService(prisma, fakeConfig()).getSnapshot(14, NOW);
    const baubles = out.ornaments.find((o) => o.slot === 'baubles')!;
    expect(baubles.unlock).toEqual({ users: 3, taps: 3 });
    expect(baubles.hang).toEqual({ users: 4, taps: 6 });
    expect(baubles.remove).toEqual({ users: 1, taps: 1 });
    expect(out.ornaments.find((o) => o.slot === 'wreath')!.hang.taps).toBe(2);
    expect(out.ornaments.find((o) => o.slot === 'star')!.hang.taps).toBe(0);
    expect(out.share).toEqual({ users: 5, taps: 9 });
    expect(out.snow.on).toEqual({ users: 3, taps: 3 });
    expect(out.snow.off).toEqual({ users: 1, taps: 1 });
    expect(out.snow.offSharePct).toBe(25);
  });

  it('quay lại D+1: tách nhóm làm Noel / không, tỉ lệ từng nhóm; nhãn khoảng nhóm tới hôm kia', async () => {
    const { prisma } = fakePrisma({
      retention: [
        { did_noel: true, user_days: 40n, returned: 30n },
        { did_noel: false, user_days: 200n, returned: 60n },
      ],
    });
    const out = await new NoelMetricsService(prisma, fakeConfig()).getSnapshot(7, NOW);
    expect(out.retention.noel).toEqual({ userDays: 40, returned: 30, ratePct: 75 });
    expect(out.retention.other).toEqual({ userDays: 200, returned: 60, ratePct: 30 });
    expect(out.retention.cohortFromDayKey).toBe('2026-12-12');
    expect(out.retention.cohortToDayKey).toBe('2026-12-18');
  });

  it('quay lại chỉ có một nhóm: nhóm kia rỗng, không chia cho 0', async () => {
    const { prisma } = fakePrisma({ retention: [{ did_noel: false, user_days: 10n, returned: 2n }] });
    const out = await new NoelMetricsService(prisma, fakeConfig()).getSnapshot(1, NOW);
    expect(out.retention.noel).toEqual({ userDays: 0, returned: 0, ratePct: null });
    expect(out.retention.other.ratePct).toBe(20);
  });

  it('kinh tế: hai khoảng liền kề và trần đọc từ cấu hình (kẹp biên)', async () => {
    const { prisma, seen } = fakePrisma({
      ledger: [{ users: 9n, rounds: 40n, water: 300n, points: 120n, max_w: 40n, max_p: 30n }],
      global: [{ max_points: 900n }],
      arcadeWater: [{ runs: 25n, water: 125n }],
    });
    const cfg = fakeConfig({ 'game.mini.water_daily_cap': 40, 'game.mini.points_daily_cap': 100, 'game.mini.global_points_daily_budget': 200_000 });
    const out = await new NoelMetricsService(prisma, cfg).getSnapshot(7, NOW);
    expect(out.economy.caps).toEqual({ miniWaterPerUserDay: 40, miniPointsPerUserDay: 100, miniGlobalPointsPerDay: 200_000 });
    expect(out.economy.current).toMatchObject({
      fromDayKey: '2026-12-14',
      toDayKey: '2026-12-20',
      miniUsers: 9,
      miniRewardedRounds: 40,
      miniWater: 300,
      miniPoints: 120,
      maxUserWaterInDay: 40,
      maxUserPointsInDay: 30,
      maxGlobalPointsInDay: 900,
      arcadeRewardedRuns: 25,
      arcadeWater: 125,
    });
    expect(out.economy.previous).toMatchObject({ fromDayKey: '2026-12-07', toDayKey: '2026-12-13' });
    // Mỗi khoảng chạy đủ 3 câu (sổ mini, ngân sách toàn hệ thống, arcade) → 2 khoảng = 6 câu.
    const economyQueries = seen.filter((s) => /game_daily_ledger|game_global_daily|game_water_events/.test(s.sql));
    expect(economyQueries).toHaveLength(6);
  });

  it('số câu truy vấn cố định, không phụ thuộc dữ liệu (không N+1)', async () => {
    const empty = fakePrisma();
    await new NoelMetricsService(empty.prisma, fakeConfig()).getSnapshot(14, NOW);
    const busy = fakePrisma({
      claimDay: Array.from({ length: 14 }, (_, i) => ({ day_key: `2026-12-${String(7 + i).padStart(2, '0')}`, claims: 100n })),
      mini: Array.from({ length: 8 }, (_, i) => ({ game: `g${i}`, plays: 10n, users: 5n, avg_c: 3, avg_t: 5, rewarded: 4n, water: 10n, points: 2n })),
      actions: Array.from({ length: 30 }, () => ({ action: 'share_tap', slot: null, taps: 1n, users: 1n })),
    });
    await new NoelMetricsService(busy.prisma, fakeConfig()).getSnapshot(14, NOW);
    expect(busy.tx.$queryRaw.mock.calls.length).toBe(empty.tx.$queryRaw.mock.calls.length);
    // 1 set_config + 2 nhận quà + 2 lịch + 1 thao tác + 1 mini + 1 arcade + 6 kinh tế + 1 quay lại = 15 câu cho mọi cỡ dữ liệu.
    expect(busy.tx.$queryRaw.mock.calls.length).toBe(15);
  });

  it('đặt statement_timeout trong transaction trước mọi câu truy vấn', async () => {
    const { prisma, seen } = fakePrisma();
    await new NoelMetricsService(prisma, fakeConfig()).getSnapshot(7, NOW);
    expect(seen[0]!.sql).toContain('set_config');
    expect(seen[0]!.values).toEqual(['10000']);
  });

  it('truyền mốc giờ VN đã đổi sang UTC cho các câu đọc sự kiện (23:59 VN còn trong ngày, 00:00 VN sang ngày mới)', async () => {
    const { prisma, seen } = fakePrisma();
    await new NoelMetricsService(prisma, fakeConfig()).getSnapshot(1, new Date('2026-12-20T16:59:59.999Z'));
    const actions = seen.find((s) => s.sql.includes(`'noel_action'`) && !s.sql.includes('WITH ev AS'))!;
    expect(actions.values).toEqual(['2026-12-19T17:00:00.000Z', '2026-12-20T17:00:00.000Z']);

    const next = fakePrisma();
    await new NoelMetricsService(next.prisma, fakeConfig()).getSnapshot(1, new Date('2026-12-20T17:00:00.000Z'));
    const actions2 = next.seen.find((s) => s.sql.includes(`'noel_action'`) && !s.sql.includes('WITH ev AS'))!;
    expect(actions2.values).toEqual(['2026-12-20T17:00:00.000Z', '2026-12-21T17:00:00.000Z']);
  });
});

describe('NoelMetricsService — cache', () => {
  it('trong 60 giây dùng lại kết quả cùng `days`, khác `days` tính riêng, quá hạn tính lại', async () => {
    const { prisma, tx } = fakePrisma();
    const svc = new NoelMetricsService(prisma, fakeConfig());
    const a = await svc.getSnapshot(7, NOW);
    const afterFirst = tx.$queryRaw.mock.calls.length;
    const b = await svc.getSnapshot(7, new Date(NOW.getTime() + 59_000));
    expect(b).toBe(a);
    expect(tx.$queryRaw.mock.calls.length).toBe(afterFirst);

    await svc.getSnapshot(14, new Date(NOW.getTime() + 1_000));
    expect(tx.$queryRaw.mock.calls.length).toBeGreaterThan(afterFirst);

    const c = await svc.getSnapshot(7, new Date(NOW.getTime() + 61_000));
    expect(c).not.toBe(a);
  });

  it('hai lời gọi đồng thời chỉ chạy một lượt truy vấn', async () => {
    const { prisma } = fakePrisma();
    const svc = new NoelMetricsService(prisma, fakeConfig());
    const [a, b] = await Promise.all([svc.getSnapshot(1, NOW), svc.getSnapshot(1, NOW)]);
    expect(a).toBe(b);
    expect((prisma.$transaction as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('lượt lỗi không bị cache: lần sau thử lại', async () => {
    const { prisma } = fakePrisma();
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('statement timeout'));
    const svc = new NoelMetricsService(prisma, fakeConfig());
    await expect(svc.getSnapshot(7, NOW)).rejects.toThrow('statement timeout');
    await expect(svc.getSnapshot(7, new Date(NOW.getTime() + 1_000))).resolves.toMatchObject({ days: 7 });
  });
});

describe('buildGameRows', () => {
  it('Arcade lấy điểm TB từ sự kiện, mini lấy đúng/tổng; game khác xếp sau theo số ván; bỏ game arcade lạ', () => {
    const rows = buildGameRows(
      [
        { game: 'eco_merge', plays: 20n, users: 8n, avg_c: 4.26, avg_t: 8, rewarded: 12n, water: 60n, points: 12n },
        { game: 'daily_quiz', plays: 50n, users: 30n, avg_c: 2.5, avg_t: 3, rewarded: 30n, water: 90n, points: 30n },
        { game: 'sort', plays: 5n, users: 5n, avg_c: 3, avg_t: 5, rewarded: 0n, water: 0n, points: 0n },
      ],
      [
        { game: 'dew_catcher', plays: 100n, users: 40n, avg_score: 412.349, rewarded: 70n, water: 350n, points: 70n },
        { game: 'tetris', plays: 9n, users: 1n, avg_score: 10, rewarded: 0n, water: 0n, points: 0n },
        { game: null, plays: 1n, users: 1n, avg_score: 1, rewarded: 0n, water: 0n, points: 0n },
      ],
    );
    expect(rows.map((r) => r.game)).toEqual(['dew_catcher', 'refill_rush', 'eco_merge', 'green_conveyor', 'daily_quiz', 'sort']);
    expect(rows[0]).toMatchObject({ kind: 'arcade', plays: 100, avgScore: 412.3, avgOutOf: null, rewardedPlays: 70, water: 350, points: 70 });
    expect(rows[1]).toMatchObject({ kind: 'arcade', plays: 0, avgScore: null });
    expect(rows[2]).toMatchObject({ kind: 'mini', plays: 20, avgScore: 4.3, avgOutOf: 8 });
    expect(rows[3]).toMatchObject({ kind: 'mini', plays: 0, avgScore: null });
  });
});
