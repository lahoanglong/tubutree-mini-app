/**
 * Hợp đồng chung của nhịp hằng ngày (API `/game/daily*`, `/game/badges`, Mini App và web): 3 nhiệm vụ mỗi ngày chọn từ một rổ, thưởng
 * tính chung trần game mini; 8 huy hiệu ghi nhận không có điểm. Hai cờ `engagement.daily_missions_enabled` và `engagement.badges_enabled`
 * tắt thì API trả `enabled: false` và app vẽ như trước.
 */
import type { MiniCapId } from './game-mini';

export const DAILY_MISSION_IDS = ['DAILY_QUIZ', 'DAILY_PLAY', 'DAILY_STORY', 'DAILY_WISHLIST', 'DAILY_WATER'] as const;
export type DailyMissionId = (typeof DAILY_MISSION_IDS)[number];

export function isDailyMissionId(v: unknown): v is DailyMissionId {
  return typeof v === 'string' && (DAILY_MISSION_IDS as readonly string[]).includes(v);
}

/** Số nhiệm vụ mỗi khách mỗi ngày, 💧 mỗi nhiệm vụ và Điểm Xanh khi nhận đủ cả 3 (trước trần chung của game mini). */
export const DAILY_MISSIONS_PER_DAY = 3;
export const DAILY_MISSION_WATER = 5;
export const DAILY_BONUS_POINTS = 10;

export interface DailyMissionItem {
  id: DailyMissionId;
  /** Khách đã làm việc của nhiệm vụ hôm nay (giờ VN). */
  done: boolean;
  /** Đã nhận thưởng hôm nay. */
  claimed: boolean;
}

export interface DailyMissionsResponse {
  /** Cờ engagement.daily_missions_enabled; false thì các trường còn lại rỗng và app không vẽ gì mới. */
  enabled: boolean;
  /** Ngày VN 'YYYY-MM-DD' của bộ nhiệm vụ. */
  dayKey: string | null;
  missions: DailyMissionItem[];
  water: number;
  bonusPoints: number;
  bonusClaimed: boolean;
  /** Khách vãng lai (chưa liên kết Zalo hay SĐT): xem được tiến độ, không nhận thưởng. */
  pointsBlocked: boolean;
  /** 💧 và Điểm Xanh còn nhận được hôm nay theo trần chung của game mini (đã trừ phần các ván game đã nhận). */
  waterLeft: number;
  pointsLeft: number;
  /** Đố Xanh đang bật và hôm nay khách chưa làm: một lý do của chấm nhắc ở tab Vườn Xanh. */
  quizPending: boolean;
}

export interface DailyMissionClaimResponse {
  id: DailyMissionId;
  /** Thưởng thật đã cộng sau trần (có thể 0 khi đã đủ trần ngày). */
  water: number;
  points: number;
  /** Lần nhận này là nhiệm vụ thứ 3 của ngày nên có thêm thưởng ngày (points là phần thưởng đó sau trần). */
  bonus: boolean;
  capped: MiniCapId[];
  totalSeeds: number | null;
}

export const DAILY_ERROR_CODES = {
  disabled: 'DAILY_DISABLED',
  notToday: 'DAILY_NOT_TODAY',
  notDone: 'DAILY_NOT_DONE',
  claimed: 'DAILY_CLAIMED',
  guest: 'DAILY_GUEST',
  tooNew: 'DAILY_TOO_NEW',
} as const;
export type DailyErrorCode = (typeof DAILY_ERROR_CODES)[keyof typeof DAILY_ERROR_CODES];

/** Thứ tự hiện trong hàng huy hiệu. */
export const BADGE_IDS = [
  'FIRST_ORDER',
  'RECYCLE_3',
  'REFILL_5',
  'STREAK_7',
  'STREAK_30',
  'QUIZ_PERFECT_10',
  'PHOTO_REVIEW',
  'INVITE_1',
] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

export function isBadgeId(v: unknown): v is BadgeId {
  return typeof v === 'string' && (BADGE_IDS as readonly string[]).includes(v);
}

/**
 * Huy hiệu thuộc bài của Sổ tay Xanh (cờ game.album_enabled), 0 điểm: thuộc 10 thẻ, thuộc trọn một chủ đề, thuộc cả sổ. Ghi vào cùng
 * bảng `user_badges` nhưng KHÔNG nằm trong `BADGE_IDS`: hàng huy hiệu chung tự điền mọi id của `BADGE_IDS` còn thiếu, nên thêm vào đó là
 * lộ 3 ô mới cả khi cờ tắt. Sổ tay tự hiện 3 huy hiệu này.
 */
export const ALBUM_BADGE_IDS = ['ALBUM_MASTER_10', 'ALBUM_TOPIC', 'ALBUM_ALL'] as const;
export type AlbumBadgeId = (typeof ALBUM_BADGE_IDS)[number];

export interface BadgeItem {
  id: BadgeId;
  earned: boolean;
  /** ISO; null khi chưa đạt. */
  earnedAt: string | null;
}

export interface BadgesResponse {
  /** Cờ engagement.badges_enabled; false thì `badges` rỗng và app không vẽ hàng huy hiệu. */
  enabled: boolean;
  badges: BadgeItem[];
}
