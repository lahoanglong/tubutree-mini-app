import type { HttpClient } from '../http';

/**
 * Cờ `game.matcher_enabled` của "Chọn Chuẩn Xanh" (`GET /game/matcher/status`, luôn 200). Tách khỏi `matcher.ts` vì lối vào (thẻ Chơi hôm nay,
 * trang Tư vấn, giỏ trống, dòng chữ trên Mini) chỉ cần biết bật hay tắt: phần câu hỏi và kết quả nằm trong chunk của trang chơi.
 */
export interface MatcherStatus {
  enabled: boolean;
}

export const MATCHER_STATUS_KEY = ['game', 'matcher', 'status'] as const;

export const getMatcherStatus = (http: HttpClient) => http.get<MatcherStatus>('/game/matcher/status');

/** Lỗi hay chưa tải xong thì coi như tắt: lối vào không hiện, không hứa thứ máy chủ chưa mở. */
export const matcherStatusQuery = (http: HttpClient) => ({
  queryKey: MATCHER_STATUS_KEY,
  queryFn: () => getMatcherStatus(http),
  staleTime: 5 * 60_000,
  retry: 1,
});

/** Màn chơi ở Mini App (cặp route-map `/game/matcher` ↔ `MATCHER_PATH` của web). Nằm ở đây vì thẻ Chơi hôm nay của Mini chỉ nạp file này. */
export const MATCHER_MINI_PATH = '/game/matcher';

export const matcherOn = (s: MatcherStatus | undefined | null): boolean => s?.enabled === true;
