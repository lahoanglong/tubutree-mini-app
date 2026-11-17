import type { MiniNoRewardReason, MiniTodayResponse } from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import { errorStatus } from '../api/error-status';

/**
 * Lượt chơi có thưởng của game mini hôm nay (`GET /game/mini/today`, lõi ở wave tubu-game-core). Máy chủ là nguồn của cờ: trả 404
 * `GAME_DISABLED` khi `game.mini.enabled` tắt, nên client không cần khoá cấu hình công khai riêng. Tách khỏi `api.ts` vì trang Vườn Xanh chỉ cần
 * phần này: phần bắt đầu/nộp ván nằm trong chunk lười của màn chơi.
 */
export const MINI_TODAY_KEY = ['game', 'mini', 'today'] as const;

export const getMiniToday = (http: HttpClient) => http.get<MiniTodayResponse>('/game/mini/today');

/** Làm mới phiên của nền tảng; `true` khi đã có access token mới. */
export type MiniSessionRefresh = () => Promise<boolean>;

/**
 * Có phiên mà máy chủ vẫn trả lời như với khách chưa đăng nhập: access token đã hết hạn. Route game mini dùng `OptionalJwtAuthGuard`, token hết
 * hạn thành khách chứ không 401, nên interceptor 401 của client không tự làm mới phiên.
 */
export const isStaleSession = (authed: boolean, r: { noRewardReason: MiniNoRewardReason | null }) => authed && r.noRewardReason === 'NOT_LOGGED_IN';

/** Gọi `load`; có phiên mà nhận câu trả lời của khách thì làm mới phiên rồi gọi lại một lần. */
export async function withFreshSession<T extends { noRewardReason: MiniNoRewardReason | null }>(
  load: () => Promise<T>,
  authed: boolean,
  refresh?: MiniSessionRefresh,
): Promise<T> {
  const r = await load();
  return refresh && isStaleSession(authed, r) && (await refresh()) ? load() : r;
}

/**
 * Query "Chơi hôm nay". Cờ tắt (404) là trạng thái bình thường của PROD nên không thử lại; lỗi khác thử lại một lần.
 * `staleTime` ngắn: số lượt thưởng còn lại đổi sau mỗi ván và màn chơi tự làm mới khoá này khi nộp xong. Khoá tách khách và thành viên:
 * bản tải lúc phiên chưa khôi phục xong (khách, "chơi thử") không được dùng lại sau khi đăng nhập; bản của thành viên mà token đã hết hạn
 * thì làm mới phiên rồi tải lại, không lưu câu trả lời của khách dưới khoá thành viên.
 */
export const miniTodayQuery = (http: HttpClient, authed: boolean, refresh?: MiniSessionRefresh) => ({
  queryKey: [...MINI_TODAY_KEY, authed ? 'member' : 'guest'] as const,
  queryFn: () => withFreshSession(() => getMiniToday(http), authed, refresh),
  staleTime: 30_000,
  retry: (count: number, err: unknown) => !isMiniDisabled(err) && count < 1,
});

/** Cờ chung hoặc cờ của game tắt: API trả 404 cho mọi route game mini. */
export function isMiniDisabled(err: unknown): boolean {
  return errorStatus(err) === 404;
}
