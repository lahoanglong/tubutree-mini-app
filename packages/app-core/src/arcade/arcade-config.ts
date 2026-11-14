export const ARCADE_GAME_IDS = ['dew_catcher', 'refill_rush'] as const;
export type ArcadeGameId = (typeof ARCADE_GAME_IDS)[number];
export type ArcadeWindowId = 'SUONG_SOM' | 'MUA_RAO';
export type ArcadeTier = 'base' | 'good' | 'great';

export const ARCADE_NOMINAL_MS: Record<ArcadeGameId, number> = { dew_catcher: 40_000, refill_rush: 45_000 };
export const ARCADE_MAX_SCORE_PER_SEC: Record<ArcadeGameId, number> = { dew_catcher: 120, refill_rush: 60 };
export const ARCADE_MIN_DURATION_MS = 5_000;
const TIERS: Record<ArcadeGameId, [good: number, great: number]> = { dew_catcher: [400, 900], refill_rush: [250, 550] };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WINDOWS: readonly (readonly [ArcadeWindowId, number, number])[] = [['SUONG_SOM', 6.5 * HOUR, 9 * HOUR], ['MUA_RAO', 20 * HOUR, 22 * HOUR]];

/** Mili giây từ 00:00 giờ VN bằng số học UTC: không phụ thuộc TZ của máy. */
const vnMs = (d: Date) => (((d.getTime() + 7 * HOUR) % DAY) + DAY) % DAY;

export const arcadeWindowAt = (now: Date): ArcadeWindowId | null => WINDOWS.find(([, from, to]) => vnMs(now) >= from && vnMs(now) < to)?.[0] ?? null;

/** Theo lúc ván hoàn thành. */
export const arcadeDailyCap = (now: Date): number => (arcadeWindowAt(now) ? 4 : 3);

/** Đầu khung gần nhất sau `now` (đang trong khung thì là khung kế). */
export function nextArcadeWindowStart(now: Date): Date {
  const t = vnMs(now);
  const next = WINDOWS.find(([, from]) => from > t);
  return new Date(now.getTime() - t + (next ? next[1] : DAY + WINDOWS[0]![1]));
}

export function arcadeScoreTier(gameId: ArcadeGameId, score: number): ArcadeTier {
  const [good, great] = TIERS[gameId];
  return score >= great ? 'great' : score >= good ? 'good' : 'base';
}

export const arcadeWaterFor = (gameId: ArcadeGameId, score: number, base = 5): number =>
  base + { base: 0, good: 3, great: 5 }[arcadeScoreTier(gameId, score)];
