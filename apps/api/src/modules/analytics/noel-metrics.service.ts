import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  NoelDayCount,
  NoelEconomyPeriod,
  NoelGameRow,
  NoelMetricsDTO,
  NoelOrnamentRow,
  NoelRetentionGroup,
  NoelTapCount,
  NoelWindowDays,
} from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { readMiniSettings } from '../game/mini/game-mini.settings';
import { normalizeSeasonalTheme, SEASONAL_THEME_FALLBACK, SEASONAL_THEME_KEY } from '../system-config/seasonal-theme';
import { SystemConfigService } from '../system-config/system-config.service';
import { adventRequiredDays, adventSpan, NOEL_ORNAMENT_SLOTS, noelWindow, pct, round1, type NoelWindow } from './noel-metrics-window';

/** ADMIN bấm Làm mới liên tục không dồn truy vấn quét bảng sự kiện vào DB (cùng mức bảng Theo dõi 72h). */
const CACHE_TTL_MS = 60_000;
/** Mỗi câu truy vấn quá ngần này mili giây thì DB tự dừng: tab đo đạc không được giữ kết nối quá lâu. */
const STATEMENT_TIMEOUT_MS = 10_000;
const TX_TIMEOUT_MS = 60_000;

/** Lượt thưởng arcade có `reason` riêng ở `game_water_events` (khớp ARCADE_WATER_REASONS ở game-arcade.constants.ts). */
const ARCADE_WATER_REASON_LIST = ['ARCADE_DEW_CATCHER', 'ARCADE_REFILL_RUSH'];
const ARCADE_GAMES = ['dew_catcher', 'refill_rush'] as const;
/** Bốn game chiếu sáng ở màn Noel luôn có dòng, kể cả khi chưa ai chơi. */
const FEATURED_GAMES: ReadonlyArray<{ game: string; kind: 'arcade' | 'mini' }> = [
  { game: 'dew_catcher', kind: 'arcade' },
  { game: 'refill_rush', kind: 'arcade' },
  { game: 'eco_merge', kind: 'mini' },
  { game: 'green_conveyor', kind: 'mini' },
];
/** Sự kiện coi là "có mặt trong app" khi tính quay lại D+1: Mini App mở app, web đổi trang, hoặc thao tác Noel. Điểm danh được nối thêm từ `loyalty_check_ins`. */
const ACTIVITY_EVENTS = ['app_opened', 'screen_viewed', 'noel_action'];

type Count = number | bigint | null;
type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;
const n = (v: Count | undefined): number => (v == null ? 0 : Number(v));
const ts = (d: Date): string => d.toISOString();
const zeroTap = (): NoelTapCount => ({ users: 0, taps: 0 });

interface ClaimDayRow { day_key: string; claims: Count }
interface ClaimTotalRow { users: Count; s3: Count; s7: Count }
interface AdventDayRow { day_key: string; users: Count }
interface AdventDoneRow { opened_any: Count; completed: Count }
interface ActionRow { action: string | null; slot: string | null; taps: Count; users: Count }
interface MiniRow { game: string; plays: Count; users: Count; avg_c: number | null; avg_t: number | null; rewarded: Count; water: Count; points: Count }
interface ArcadeRow { game: string | null; plays: Count; users: Count; avg_score: number | null; rewarded: Count; water: Count; points: Count }
interface LedgerRow { users: Count; rounds: Count; water: Count; points: Count; max_w: Count; max_p: Count }
interface MaxRow { max_points: Count }
interface ArcadeWaterRow { runs: Count; water: Count }
interface RetentionRow { did_noel: boolean; user_days: Count; returned: Count }

/** Đếm lượt nhận quà (điểm danh) theo ngày VN, và số khách đạt chuỗi 3 / 7 ngày trong khoảng. Bảng chỉ có một dòng mỗi (khách, ngày). */
export async function queryClaims(db: Db, w: NoelWindow) {
  const perDay = await db.$queryRaw<ClaimDayRow[]>`
    SELECT c."dayKey" AS day_key, count(*) AS claims
      FROM "loyalty_check_ins" c
     WHERE c."dayKey" >= ${w.fromKey} AND c."dayKey" <= ${w.toKey}
     GROUP BY c."dayKey"`;
  const [total] = await db.$queryRaw<ClaimTotalRow[]>`
    SELECT count(DISTINCT c."userId") AS users,
           count(DISTINCT c."userId") FILTER (WHERE c."streakDays" >= 3) AS s3,
           count(DISTINCT c."userId") FILTER (WHERE c."streakDays" >= 7) AS s7
      FROM "loyalty_check_ins" c
     WHERE c."dayKey" >= ${w.fromKey} AND c."dayKey" <= ${w.toKey}`;
  return { perDay, total };
}

/**
 * Lịch quà 12 ngày: khách mở theo từng ô (tới hôm nay), và khách mở đủ `requiredDays` ô đầu (tới hôm qua khi lịch đang chạy).
 * Số ô đã mở của một khách là số dòng điểm danh trong khoảng vì bảng chỉ có một dòng mỗi (khách, ngày).
 */
export async function queryAdvent(db: Db, keys: readonly string[], daysElapsed: number, requiredDays: number) {
  if (daysElapsed === 0) return { perDay: [] as AdventDayRow[], done: undefined };
  const first = keys[0]!;
  const lastElapsed = keys[daysElapsed - 1]!;
  const lastRequired = keys[Math.max(0, requiredDays - 1)]!;
  const perDay = await db.$queryRaw<AdventDayRow[]>`
    SELECT c."dayKey" AS day_key, count(*) AS users
      FROM "loyalty_check_ins" c
     WHERE c."dayKey" >= ${first} AND c."dayKey" <= ${lastElapsed}
     GROUP BY c."dayKey"`;
  const [done] = await db.$queryRaw<AdventDoneRow[]>`
    SELECT count(*) AS opened_any,
           count(*) FILTER (WHERE ${requiredDays}::int > 0 AND t.opened_required >= ${requiredDays}::int) AS completed
      FROM (SELECT c."userId",
                   count(*) FILTER (WHERE c."dayKey" <= ${lastRequired}) AS opened_required
              FROM "loyalty_check_ins" c
             WHERE c."dayKey" >= ${first} AND c."dayKey" <= ${lastElapsed}
             GROUP BY c."userId") t`;
  return { perDay, done };
}

/** Thao tác Noel ở máy khách (`noel_action`): theo thao tác và món. Khách đăng nhập tính theo userId, còn lại theo mã ẩn danh. */
export async function queryActions(db: Db, w: NoelWindow) {
  return db.$queryRaw<ActionRow[]>`
    SELECT e.props->>'action' AS action, e.props->>'slot' AS slot,
           count(*) AS taps,
           count(DISTINCT coalesce(e."userId", e."anonymousId")) AS users
      FROM "analytics_events" e
     WHERE e."eventName" = 'noel_action'
       AND e."occurredAt" >= ${ts(w.since)}::timestamp AND e."occurredAt" < ${ts(w.until)}::timestamp
     GROUP BY 1, 2`;
}

/** Game mini: mỗi dòng `game_play_rounds` đã nộp là một ván. `correct`/`total` là số câu đúng hoặc bậc đạt trên tối đa. */
export async function queryMiniGames(db: Db, w: NoelWindow) {
  return db.$queryRaw<MiniRow[]>`
    SELECT r.game AS game,
           count(*) AS plays,
           count(DISTINCT r."userId") AS users,
           avg(r.correct)::float8 AS avg_c,
           avg(r.total)::float8 AS avg_t,
           count(*) FILTER (WHERE r."waterAwarded" > 0 OR r."pointsAwarded" > 0) AS rewarded,
           coalesce(sum(r."waterAwarded"), 0) AS water,
           coalesce(sum(r."pointsAwarded"), 0) AS points
      FROM "game_play_rounds" r
     WHERE r."submittedAt" >= ${ts(w.since)}::timestamp AND r."submittedAt" < ${ts(w.until)}::timestamp
     GROUP BY r.game`;
}

/** Arcade (Hứng Giọt Sương, Băng Chuyền Refill): máy chủ chỉ lưu kỷ lục, nên ván và điểm đọc từ sự kiện máy chủ `arcade_run`. */
export async function queryArcadeRuns(db: Db, w: NoelWindow) {
  return db.$queryRaw<ArcadeRow[]>`
    SELECT e.props->>'gameId' AS game,
           count(*) AS plays,
           count(DISTINCT e."userId") AS users,
           avg((e.props->>'score')::float8) AS avg_score,
           count(*) FILTER (WHERE e.props->>'rewarded' = 'true') AS rewarded,
           coalesce(sum((e.props->>'water')::int), 0) AS water,
           coalesce(sum((e.props->>'points')::int), 0) AS points
      FROM "analytics_events" e
     WHERE e."eventName" = 'arcade_run'
       AND e."occurredAt" >= ${ts(w.since)}::timestamp AND e."occurredAt" < ${ts(w.until)}::timestamp
     GROUP BY 1`;
}

/** Thưởng đã phát trong một khoảng, từ sổ (không từ sự kiện) để hai khoảng so được với nhau. */
export async function queryEconomy(db: Db, fromKey: string, toKey: string, since: Date, until: Date): Promise<NoelEconomyPeriod> {
  const [ledger] = await db.$queryRaw<LedgerRow[]>`
    SELECT count(DISTINCT l."userId") AS users,
           coalesce(sum(l."rewardedRounds"), 0) AS rounds,
           coalesce(sum(l."waterFromGames"), 0) AS water,
           coalesce(sum(l."pointsFromGames"), 0) AS points,
           coalesce(max(l."waterFromGames"), 0) AS max_w,
           coalesce(max(l."pointsFromGames"), 0) AS max_p
      FROM "game_daily_ledger" l
     WHERE l."dayKey" >= ${fromKey} AND l."dayKey" <= ${toKey}`;
  const [global] = await db.$queryRaw<MaxRow[]>`
    SELECT coalesce(max(g."pointsMinted"), 0) AS max_points
      FROM "game_global_daily" g
     WHERE g."dayKey" >= ${fromKey} AND g."dayKey" <= ${toKey}`;
  const [arcade] = await db.$queryRaw<ArcadeWaterRow[]>`
    SELECT count(*) AS runs, coalesce(sum(w.delta), 0) AS water
      FROM "game_water_events" w
     WHERE w.reason = ANY(${ARCADE_WATER_REASON_LIST}::text[])
       AND w."createdAt" >= ${ts(since)}::timestamp AND w."createdAt" < ${ts(until)}::timestamp`;
  return {
    fromDayKey: fromKey,
    toDayKey: toKey,
    miniUsers: n(ledger?.users),
    miniRewardedRounds: n(ledger?.rounds),
    miniWater: n(ledger?.water),
    miniPoints: n(ledger?.points),
    maxUserWaterInDay: n(ledger?.max_w),
    maxUserPointsInDay: n(ledger?.max_p),
    maxGlobalPointsInDay: n(global?.max_points),
    arcadeRewardedRuns: n(arcade?.runs),
    arcadeWater: n(arcade?.water),
  };
}

/**
 * Quay lại D+1 của cặp (khách, ngày) đã đăng nhập: "làm Noel" là nhận quà (điểm danh) hoặc có `noel_action` ngày đó; nhóm còn lại là khách có mặt
 * trong app ngày đó mà không làm Noel. "Quay lại" là có mặt (mở app, đổi trang, thao tác Noel hoặc điểm danh) vào ngày kế tiếp, cùng một luật cho hai nhóm.
 * Một lượt đọc `analytics_events` cho cả hoạt động lẫn thao tác Noel. Ngày tính theo giờ VN bằng cộng 7 giờ vào mốc UTC đã lưu.
 */
export async function queryRetention(db: Db, w: NoelWindow) {
  return db.$queryRaw<RetentionRow[]>`
    WITH ev AS (
      SELECT e."userId" AS uid,
             ((e."occurredAt" + interval '7 hours')::date) AS d,
             (e."eventName" = 'noel_action') AS is_noel
        FROM "analytics_events" e
       WHERE e."eventName" = ANY(${ACTIVITY_EVENTS}::text[])
         AND e."userId" IS NOT NULL
         AND e."occurredAt" >= ${ts(w.cohortSince)}::timestamp AND e."occurredAt" < ${ts(w.cohortUntil)}::timestamp
    ),
    ci AS (
      SELECT c."userId" AS uid, c."dayKey"::date AS d
        FROM "loyalty_check_ins" c
       WHERE c."dayKey" >= ${w.cohortFromKey} AND c."dayKey" < ${w.todayKey}
    ),
    act AS (
      SELECT uid, d FROM ev
      UNION
      SELECT uid, d FROM ci
    ),
    noel AS (
      SELECT uid, d FROM ev WHERE is_noel
      UNION
      SELECT uid, d FROM ci
    )
    SELECT (n.uid IS NOT NULL) AS did_noel,
           count(*) AS user_days,
           count(*) FILTER (WHERE r.uid IS NOT NULL) AS returned
      FROM act a
      LEFT JOIN noel n ON n.uid = a.uid AND n.d = a.d
      LEFT JOIN act r ON r.uid = a.uid AND r.d = a.d + 1
     WHERE a.d >= ${w.cohortFromKey}::date AND a.d <= ${w.cohortToKey}::date
     GROUP BY 1`;
}

function tapOf(rows: readonly ActionRow[], action: string, slot?: string): NoelTapCount {
  const pick = rows.filter((r) => r.action === action && (slot === undefined || r.slot === slot));
  if (pick.length === 0) return zeroTap();
  // Thao tác không mang `slot` (chia sẻ, tuyết) chỉ có một dòng; món trang trí luôn lọc theo đúng `slot`: không bao giờ cộng khách của hai dòng.
  return { users: pick.reduce((s, r) => s + n(r.users), 0), taps: pick.reduce((s, r) => s + n(r.taps), 0) };
}

function groupOf(rows: readonly RetentionRow[], didNoel: boolean): NoelRetentionGroup {
  const row = rows.find((r) => r.did_noel === didNoel);
  const userDays = n(row?.user_days);
  const returned = n(row?.returned);
  return { userDays, returned, ratePct: pct(returned, userDays) };
}

export function buildGameRows(mini: readonly MiniRow[], arcade: readonly ArcadeRow[]): NoelGameRow[] {
  const rows = new Map<string, NoelGameRow>();
  for (const f of FEATURED_GAMES) {
    rows.set(f.game, { game: f.game, kind: f.kind, plays: 0, users: 0, avgScore: null, avgOutOf: null, rewardedPlays: 0, water: 0, points: 0 });
  }
  for (const r of mini) {
    rows.set(r.game, {
      game: r.game,
      kind: 'mini',
      plays: n(r.plays),
      users: n(r.users),
      avgScore: round1(r.avg_c),
      avgOutOf: round1(r.avg_t),
      rewardedPlays: n(r.rewarded),
      water: n(r.water),
      points: n(r.points),
    });
  }
  for (const r of arcade) {
    if (!r.game || !(ARCADE_GAMES as readonly string[]).includes(r.game)) continue;
    rows.set(r.game, {
      game: r.game,
      kind: 'arcade',
      plays: n(r.plays),
      users: n(r.users),
      avgScore: round1(r.avg_score),
      avgOutOf: null,
      rewardedPlays: n(r.rewarded),
      water: n(r.water),
      points: n(r.points),
    });
  }
  const featured = FEATURED_GAMES.map((f) => rows.get(f.game)!);
  const others = [...rows.values()].filter((r) => !FEATURED_GAMES.some((f) => f.game === r.game)).sort((a, b) => b.plays - a.plays || a.game.localeCompare(b.game));
  return [...featured, ...others];
}

/**
 * Số liệu tab Noel của Admin. Chỉ đọc: suy ra từ bảng có sẵn (điểm danh, ván game, sổ thưởng) cộng hai sự kiện thêm vào (`noel_action` từ máy khách,
 * `arcade_run` từ máy chủ), không migration. Một lượt tính mỗi `days` (cache 60 giây, kể cả lượt đang chạy): mọi câu truy vấn chạy tuần tự trong
 * một transaction ngắn có `statement_timeout`, mỗi câu gộp theo nhóm nên số câu cố định, không phụ thuộc số khách.
 */
@Injectable()
export class NoelMetricsService {
  private readonly cache = new Map<NoelWindowDays, { at: number; value: Promise<NoelMetricsDTO> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  getSnapshot(days: NoelWindowDays, now: Date = new Date()): Promise<NoelMetricsDTO> {
    const hit = this.cache.get(days);
    const age = hit ? now.getTime() - hit.at : -1;
    if (hit && age >= 0 && age < CACHE_TTL_MS) return hit.value;
    const value = this.compute(days, now);
    const entry = { at: now.getTime(), value };
    this.cache.set(days, entry);
    value.catch(() => {
      if (this.cache.get(days) === entry) this.cache.delete(days);
    });
    return value;
  }

  private async compute(days: NoelWindowDays, now: Date): Promise<NoelMetricsDTO> {
    const w = noelWindow(now, days);
    const advent = adventSpan(w.todayKey);
    const requiredDays = adventRequiredDays(advent);
    // Đọc cấu hình NGOÀI transaction: cache nguội trong transaction xin kết nối thứ hai và có thể cạn pool.
    const [themeRaw, mini] = await Promise.all([this.config.get<unknown>(SEASONAL_THEME_KEY, SEASONAL_THEME_FALLBACK), readMiniSettings(this.config)]);

    const q = await this.prisma.$transaction(
      async (tx) => {
        // `SET LOCAL` không nhận tham số ràng buộc; set_config(..., true) có cùng phạm vi giao dịch.
        await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`;
        const claims = await queryClaims(tx, w);
        const adventRows = await queryAdvent(tx, advent.keys, advent.daysElapsed, requiredDays);
        const actions = await queryActions(tx, w);
        const miniRows = await queryMiniGames(tx, w);
        const arcadeRows = await queryArcadeRuns(tx, w);
        const current = await queryEconomy(tx, w.fromKey, w.toKey, w.since, w.until);
        const previous = await queryEconomy(tx, w.prevFromKey, w.prevToKey, w.prevSince, w.prevUntil);
        const retention = await queryRetention(tx, w);
        return { claims, adventRows, actions, miniRows, arcadeRows, current, previous, retention };
      },
      { timeout: TX_TIMEOUT_MS, maxWait: 5_000 },
    );

    const claimByDay = new Map(q.claims.perDay.map((r) => [r.day_key, n(r.claims)]));
    const perDay: NoelDayCount[] = w.dayKeys.map((dayKey) => ({ dayKey, count: claimByDay.get(dayKey) ?? 0 }));

    const adventByDay = new Map(q.adventRows.perDay.map((r) => [r.day_key, n(r.users)]));
    const openedAny = n(q.adventRows.done?.opened_any);
    const completed = requiredDays > 0 ? n(q.adventRows.done?.completed) : null;

    const ornaments: NoelOrnamentRow[] = NOEL_ORNAMENT_SLOTS.map((slot) => ({
      slot,
      unlock: tapOf(q.actions, 'ornament_unlock', slot),
      hang: tapOf(q.actions, 'ornament_on', slot),
      remove: tapOf(q.actions, 'ornament_off', slot),
    }));
    const snowOn = tapOf(q.actions, 'snow_on');
    const snowOff = tapOf(q.actions, 'snow_off');

    return {
      generatedAt: now.toISOString(),
      days,
      seasonalTheme: normalizeSeasonalTheme(themeRaw),
      fromDayKey: w.fromKey,
      toDayKey: w.toKey,
      claims: {
        users: n(q.claims.total?.users),
        claims: perDay.reduce((s, d) => s + d.count, 0),
        perDay,
        reachedStreak3: n(q.claims.total?.s3),
        reachedStreak7: n(q.claims.total?.s7),
      },
      advent: {
        year: advent.year,
        phase: advent.phase,
        daysElapsed: advent.daysElapsed,
        requiredDays,
        opensByDay: advent.keys.map((dayKey, i) => ({ day: i + 1, dayKey, users: adventByDay.get(dayKey) ?? 0 })),
        openedAny,
        completed,
        completionPct: completed === null ? null : pct(completed, openedAny),
      },
      ornaments,
      share: tapOf(q.actions, 'share_tap'),
      snow: { on: snowOn, off: snowOff, offSharePct: pct(snowOff.taps, snowOn.taps + snowOff.taps) },
      games: buildGameRows(q.miniRows, q.arcadeRows),
      economy: {
        caps: { miniWaterPerUserDay: mini.waterCap, miniPointsPerUserDay: mini.pointsCap, miniGlobalPointsPerDay: mini.globalBudget },
        current: q.current,
        previous: q.previous,
      },
      retention: {
        cohortFromDayKey: w.cohortFromKey,
        cohortToDayKey: w.cohortToKey,
        noel: groupOf(q.retention, true),
        other: groupOf(q.retention, false),
      },
    };
  }
}
