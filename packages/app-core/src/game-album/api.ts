import type { MiniErrorCode, MiniStartResponse, MiniSubmitResponse } from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import { errorCode, errorStatus } from '../api/error-status';
import type { RoundFailure } from '../game-mini/api';
import type { AlbumResponse } from './types';

/**
 * API của Sổ tay Xanh. Khoá query nằm dưới `['game']` để màn chơi tự làm mới sổ sau mỗi ván (nó làm mới cả nhánh `['game']` khi nộp xong).
 * Cờ `game.album_enabled` hoặc `game.mini.enabled` tắt: mọi route trả 404 nên không thử lại.
 */
export const ALBUM_KEY = ['game', 'album'] as const;

export const isAlbumOff = (err: unknown) => errorStatus(err) === 404;

export const albumQuery = (http: HttpClient, summary: boolean) => ({
  queryKey: [...ALBUM_KEY, summary ? 'summary' : 'full'] as const,
  queryFn: () => http.get<AlbumResponse>(summary ? '/game/album?summary=1' : '/game/album'),
  staleTime: 30_000,
  retry: (count: number, err: unknown) => !isAlbumOff(err) && count < 1,
});

/**
 * Ván "Ôn n thẻ". Máy chủ trả đúng dạng ván Đố Xanh không thưởng (`roundId` là mã ván ôn), nên ván chạy trên `roundReducer`, bàn chơi Đố Xanh và
 * màn kết quả sẵn có.
 */
export const startAlbumReview = (http: HttpClient) => http.post<MiniStartResponse>('/game/album/review/start', {});

export const submitAlbumReview = (http: HttpClient, roundId: string, answers: unknown[]) =>
  http.post<MiniSubmitResponse>('/game/album/review/submit', { roundId, answers });

const SUBMITTED: MiniErrorCode = 'ROUND_SUBMITTED';

/**
 * Lỗi bắt đầu/nộp ván ôn: không có mã nghiệp vụ mà mất mạng, 5xx, 408, 429 là lỗi tạm (máy trạng thái gửi lại cùng đáp án, máy chủ chỉ chấm một
 * lần). `already_submitted`: lần gửi trước đã được chấm nhưng mất phản hồi, ván ôn đã ghi nhận. Còn lại ván không ghi nhận được, khách quay về sổ.
 */
export function albumFailure(err: unknown): RoundFailure {
  const status = errorStatus(err);
  if (errorCode(err) === SUBMITTED) return 'already_submitted';
  return !errorCode(err) && (status === undefined || status >= 500 || status === 429 || status === 408) ? 'network' : 'rejected';
}
