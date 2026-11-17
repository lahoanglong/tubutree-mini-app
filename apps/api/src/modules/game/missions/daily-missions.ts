import { createHash } from 'node:crypto';
import { DAILY_MISSION_IDS, DAILY_MISSIONS_PER_DAY, type DailyMissionId } from '@tubutree/shared-types';
import type { SystemConfigService } from '../../system-config/system-config.service';
import { readFlag } from '../mini/game-mini.settings';

export const DAILY_MISSIONS_ENABLED_KEY = 'engagement.daily_missions_enabled';
export const BADGES_ENABLED_KEY = 'engagement.badges_enabled';

export async function readEngagementFlag(config: Pick<SystemConfigService, 'get'>, key: string): Promise<boolean> {
  return readFlag(await config.get<unknown>(key, false));
}

/**
 * 3 nhiệm vụ của khách trong ngày VN: mỗi nhiệm vụ trong rổ có hạng = sha256(userId:dayKey:id), lấy các hạng nhỏ nhất. Cùng khách cùng
 * ngày luôn ra cùng bộ (tải lại, đổi máy), sang ngày mới thì đổi. Rổ bớt một món (Đố Xanh tắt) chỉ thay món đó, các món còn lại giữ
 * nguyên. Trả theo thứ tự cố định của DAILY_MISSION_IDS để thẻ không đảo dòng mỗi ngày.
 */
export function pickDailyMissions(
  userId: string,
  dayKey: string,
  pool: readonly DailyMissionId[],
  count: number = DAILY_MISSIONS_PER_DAY,
): DailyMissionId[] {
  const rank = (id: DailyMissionId) => createHash('sha256').update(`${userId}:${dayKey}:${id}`).digest('hex');
  const picked = new Set(
    [...new Set(pool)]
      .map((id) => ({ id, r: rank(id) }))
      .sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : 0))
      .slice(0, Math.max(0, count))
      .map((x) => x.id),
  );
  return DAILY_MISSION_IDS.filter((id) => picked.has(id));
}

/** Rổ của ngày: Đố Xanh chỉ có khi game Đố Xanh đang bật; các việc khác luôn làm được. */
export function dailyMissionPool(quizOn: boolean): DailyMissionId[] {
  return DAILY_MISSION_IDS.filter((id) => id !== 'DAILY_QUIZ' || quizOn);
}

/** Id dòng mẫu trong bảng `missions` (migration 20261117120000_engagement_daily_badges). */
export const DAILY_TEMPLATE_IDS: Record<DailyMissionId | 'DAILY_BONUS', string> = {
  DAILY_QUIZ: 'daily-quiz',
  DAILY_PLAY: 'daily-play',
  DAILY_STORY: 'daily-story',
  DAILY_WISHLIST: 'daily-wishlist',
  DAILY_WATER: 'daily-water',
  DAILY_BONUS: 'daily-bonus',
};
