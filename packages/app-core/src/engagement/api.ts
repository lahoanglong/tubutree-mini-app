import {
  BADGE_IDS,
  DAILY_ERROR_CODES,
  isBadgeId,
  isDailyMissionId,
  type BadgeItem,
  type BadgesResponse,
  type DailyMissionClaimResponse,
  type DailyMissionId,
  type DailyMissionItem,
  type DailyMissionsResponse,
} from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import { errorCode, errorStatus } from '../api/error-status';

/**
 * Nhiệm vụ hằng ngày (`/game/daily`) nằm dưới ['game'] có chủ đích: Vườn Xanh làm mới ['game'] sau mỗi lần tưới, điểm danh, chơi, nên
 * dấu "đã làm" của phần Hôm nay tự cập nhật mà không phải sửa từng nút. Huy hiệu (`/game/badges`) ở khoá riêng vì chỉ màn Cá nhân đọc.
 */
export const DAILY_MISSIONS_KEY = ['game', 'daily'] as const;
export const BADGES_KEY = ['game-badges'] as const;

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export const DAILY_OFF: DailyMissionsResponse = {
  enabled: false,
  dayKey: null,
  missions: [],
  water: 0,
  bonusPoints: 0,
  bonusClaimed: false,
  pointsBlocked: false,
  waterLeft: 0,
  pointsLeft: 0,
  quizPending: false,
};

/** Body lạ thì ném lỗi (query lỗi, thẻ vẽ như cờ tắt), không đoán. `enabled: false` thì bỏ qua phần còn lại. */
export function parseDailyMissions(body: unknown): DailyMissionsResponse {
  const b = body as Partial<DailyMissionsResponse> | null | undefined;
  if (!b || typeof b.enabled !== 'boolean') throw new Error('Phản hồi /game/daily không đúng dạng');
  if (!b.enabled) return DAILY_OFF;
  const missions = Array.isArray(b.missions) ? b.missions : null;
  if (
    !missions ||
    typeof b.dayKey !== 'string' ||
    !isCount(b.water) ||
    !isCount(b.bonusPoints) ||
    !isCount(b.waterLeft) ||
    !isCount(b.pointsLeft) ||
    !missions.every((m: Partial<DailyMissionItem>) => isDailyMissionId(m?.id) && typeof m.done === 'boolean' && typeof m.claimed === 'boolean')
  ) {
    throw new Error('Phản hồi /game/daily không đúng dạng');
  }
  return {
    enabled: true,
    dayKey: b.dayKey,
    missions: missions.map((m) => ({ id: m.id, done: m.done, claimed: m.claimed })),
    water: b.water,
    bonusPoints: b.bonusPoints,
    bonusClaimed: b.bonusClaimed === true,
    pointsBlocked: b.pointsBlocked === true,
    waterLeft: b.waterLeft,
    pointsLeft: b.pointsLeft,
    quizPending: b.quizPending === true,
  };
}

export function parseBadges(body: unknown): BadgesResponse {
  const b = body as Partial<BadgesResponse> | null | undefined;
  if (!b || typeof b.enabled !== 'boolean') throw new Error('Phản hồi /game/badges không đúng dạng');
  if (!b.enabled) return { enabled: false, badges: [] };
  const rows = Array.isArray(b.badges) ? b.badges : [];
  const byId = new Map<string, BadgeItem>();
  for (const r of rows as Partial<BadgeItem>[]) {
    if (isBadgeId(r?.id) && typeof r.earned === 'boolean') byId.set(r.id, { id: r.id, earned: r.earned, earnedAt: typeof r.earnedAt === 'string' ? r.earnedAt : null });
  }
  return { enabled: true, badges: BADGE_IDS.map((id) => byId.get(id) ?? { id, earned: false, earnedAt: null }) };
}

export const getDailyMissions = async (http: HttpClient): Promise<DailyMissionsResponse> => parseDailyMissions(await http.get<unknown>('/game/daily'));
export const getBadges = async (http: HttpClient): Promise<BadgesResponse> => parseBadges(await http.get<unknown>('/game/badges'));

/** API cũ chưa có route (404) hay lỗi mạng: query lỗi và màn vẽ như cờ tắt, nên không thử lại dồn dập. */
export const dailyMissionsQuery = (http: HttpClient) => ({
  queryKey: DAILY_MISSIONS_KEY,
  queryFn: () => getDailyMissions(http),
  staleTime: 60_000,
  retry: false,
});

export const badgesQuery = (http: HttpClient) => ({
  queryKey: BADGES_KEY,
  queryFn: () => getBadges(http),
  staleTime: 5 * 60_000,
  retry: false,
});

export const claimDailyMission = (http: HttpClient, id: DailyMissionId, deviceId: string) =>
  http.post<DailyMissionClaimResponse>(`/game/daily/${id}/claim`, { deviceId });

/** Việc giao diện cần làm khi nhận thưởng hỏng. `stale`: thẻ đang hiện trạng thái cũ, tải lại là đủ. */
export const dailyClaimErrorCopy = (kind: DailyClaimFailure): 'daily.toastStale' | 'daily.toastTooNew' | 'daily.toastError' =>
  kind === 'stale' ? 'daily.toastStale' : kind === 'tooNew' ? 'daily.toastTooNew' : 'daily.toastError';
export type DailyClaimFailure = 'stale' | 'guest' | 'tooNew' | 'disabled' | 'network';

export function classifyDailyClaimError(err: unknown): DailyClaimFailure {
  const code = errorCode(err);
  if (code === DAILY_ERROR_CODES.claimed || code === DAILY_ERROR_CODES.notDone || code === DAILY_ERROR_CODES.notToday) return 'stale';
  if (code === DAILY_ERROR_CODES.guest) return 'guest';
  if (code === DAILY_ERROR_CODES.tooNew) return 'tooNew';
  if (code === DAILY_ERROR_CODES.disabled) return 'disabled';
  const status = errorStatus(err);
  if (status === 404) return 'disabled';
  if (status === 403) return 'guest';
  return 'network';
}
