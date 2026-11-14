import { VN_OFFSET_MS } from '../../common/vn-time';

export const ARCADE_GAME_IDS = ['dew_catcher', 'refill_rush'] as const;
export type ArcadeGameId = (typeof ARCADE_GAME_IDS)[number];

/** Thời lượng danh nghĩa của một ván. */
export const ARCADE_NOMINAL_MS: Record<ArcadeGameId, number> = { dew_catcher: 40_000, refill_rush: 45_000 };

/** Ván kết thúc sớm (hết tim) vẫn hợp lệ nếu chơi đủ chừng này. */
export const ARCADE_MIN_DURATION_MS = 5_000;
/** Độ trễ mạng và nhịp khung hình client được phép vượt thời lượng danh nghĩa. */
export const ARCADE_DURATION_SLACK_MS = 10_000;

/** Trần điểm một giây: ván báo điểm cao hơn mức này là số bịa. */
export const ARCADE_MAX_SCORE_PER_SEC: Record<ArcadeGameId, number> = { dew_catcher: 120, refill_rush: 60 };

export const ARCADE_GOOD_SCORE: Record<ArcadeGameId, number> = { dew_catcher: 400, refill_rush: 250 };
export const ARCADE_GREAT_SCORE: Record<ArcadeGameId, number> = { dew_catcher: 900, refill_rush: 550 };
export const ARCADE_GOOD_WATER_BONUS = 3;
export const ARCADE_GREAT_WATER_BONUS = 2;

/** Ván mới được bắt đầu sớm hơn lúc ván cũ xong chừng này (độ lệch đồng hồ, bấm chơi lại ngay) mà vẫn tính hợp lệ. */
export const ARCADE_TOO_FAST_TOLERANCE_MS = 3_000;

export const ARCADE_DAILY_CAP_BASE = 3;
export const ARCADE_WINDOW_EXTRA_RUNS = 1;

/** Cột reason của game_water_events cho lượt thưởng; refId = `${userId}:${vnDateKey}:${slot}`. */
export const ARCADE_WATER_REASONS: Record<ArcadeGameId, string> = {
  dew_catcher: 'ARCADE_DEW_CATCHER',
  refill_rush: 'ARCADE_REFILL_RUSH',
};
/** Một lần cho mỗi tài khoản: refId = userId. */
export const HOME_QUIZ_REASON = 'HOME_QUIZ_BONUS';
export const ARCADE_POINTS_REASON_PREFIX = 'GAME_ARCADE';

export const ARCADE_ENABLED_DEFAULT = true;
export const ARCADE_WATER_BASE_DEFAULT = 5;
/** Điểm Xanh một ván có thưởng (1 điểm = 1đ). 0 = không cộng điểm. */
export const ARCADE_POINTS_PER_RUN_DEFAULT = 1;
export const HOME_QUIZ_SEEDS_DEFAULT = 20;
// Biên đọc khớp biên ghi của SystemConfigService.RANGES: giá trị lọt qua đường khác (seed, SQL tay) vẫn không vượt.
export const ARCADE_WATER_BASE_MAX = 50;
export const ARCADE_POINTS_PER_RUN_MAX = 10;
export const HOME_QUIZ_SEEDS_MAX = 1_000;

export type ArcadeWindowId = 'SUONG_SOM' | 'MUA_RAO';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Khung giờ thưởng theo giờ VN, tính bằng mili giây từ 00:00: [startMs, endMs). */
export const ARCADE_WINDOWS: readonly { id: ArcadeWindowId; startMs: number; endMs: number }[] = [
  { id: 'SUONG_SOM', startMs: 6.5 * HOUR_MS, endMs: 9 * HOUR_MS },
  { id: 'MUA_RAO', startMs: 20 * HOUR_MS, endMs: 22 * HOUR_MS },
];

/** Mili giây kể từ 00:00 giờ VN của ngày chứa `now`; thuần số học UTC nên không phụ thuộc TZ của process. */
function vnMsOfDay(now: Date): number {
  return (((now.getTime() + VN_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
}

export function arcadeWindowAt(now: Date): ArcadeWindowId | null {
  const t = vnMsOfDay(now);
  return ARCADE_WINDOWS.find((w) => t >= w.startMs && t < w.endMs)?.id ?? null;
}

/** Trần lượt thưởng mỗi ngày VN mỗi game, tính theo lúc ván HOÀN THÀNH. */
export function arcadeDailyCap(now: Date): number {
  return ARCADE_DAILY_CAP_BASE + (arcadeWindowAt(now) ? ARCADE_WINDOW_EXTRA_RUNS : 0);
}

/** Giờ bắt đầu của khung gần nhất SAU `now` (đang trong khung thì là khung kế tiếp, không phải khung hiện tại). */
export function nextArcadeWindowStart(now: Date): Date {
  const dayStartMs = now.getTime() - vnMsOfDay(now);
  const t = vnMsOfDay(now);
  const upcoming = ARCADE_WINDOWS.find((w) => w.startMs > t);
  return new Date(upcoming ? dayStartMs + upcoming.startMs : dayStartMs + DAY_MS + ARCADE_WINDOWS[0]!.startMs);
}

/** Điểm tối đa hợp lệ của một ván dài `durationMs`. */
export function arcadeMaxScore(gameId: ArcadeGameId, durationMs: number): number {
  return Math.ceil((durationMs / 1000) * ARCADE_MAX_SCORE_PER_SEC[gameId]);
}

/** Giọt nước một ván có thưởng: base, cộng 3 từ mốc khá, cộng thêm 2 từ mốc xuất sắc (mặc định 5/8/10). */
export function arcadeWater(gameId: ArcadeGameId, score: number, base: number): number {
  return (
    base +
    (score >= ARCADE_GOOD_SCORE[gameId] ? ARCADE_GOOD_WATER_BONUS : 0) +
    (score >= ARCADE_GREAT_SCORE[gameId] ? ARCADE_GREAT_WATER_BONUS : 0)
  );
}
