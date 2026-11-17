import type { MiniErrorCode, MiniGameId, MiniStartResponse, MiniSubmitRequest, MiniSubmitResponse } from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import { errorCode, errorStatus } from '../api/error-status';

/** Bắt đầu và nộp một ván game mini (`/game/mini/:game/*`). Lượt hôm nay và cờ tắt ở `today.ts`. */
export const startMiniRound = (http: HttpClient, game: MiniGameId) => http.post<MiniStartResponse>(`/game/mini/${game}/start`, {});

export const submitMiniRound = (http: HttpClient, game: MiniGameId, body: MiniSubmitRequest) =>
  http.post<MiniSubmitResponse>(`/game/mini/${game}/submit`, body);

/** Lý do một lần gọi start/submit hỏng, đã quy về việc giao diện cần làm. */
export type RoundFailure =
  | 'network'
  | 'too_fast'
  | 'expired'
  | 'disabled'
  | 'no_content'
  | 'limit'
  | 'already_submitted'
  | 'login_required'
  | 'rejected';

export const MINI_DEVICE_KEY = 'tubu.game-mini.device';

export interface MiniDeviceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let memoryDeviceId: string | null = null;

/**
 * Mã thiết bị gửi kèm bài nộp (máy chủ băm rồi đếm số tài khoản nhận thưởng trên một máy). Mã riêng của game, KHÔNG dùng lại mã thiết bị
 * đăng nhập khách của Mini App (thứ đó là bí mật xác thực). Không lưu được (chế độ riêng tư, WebView chặn) thì giữ trong bộ nhớ của phiên.
 */
export function miniDeviceId(storage: MiniDeviceStorage | null, randomBytes: (n: number) => Uint8Array): string {
  try {
    const saved = storage?.getItem(MINI_DEVICE_KEY);
    if (saved && /^[0-9a-f]{32}$/.test(saved)) return saved;
  } catch {
    /* đọc bị chặn: tạo mã mới bên dưới */
  }
  const id = memoryDeviceId ?? Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
  memoryDeviceId = id;
  try {
    storage?.setItem(MINI_DEVICE_KEY, id);
  } catch {
    /* ghi bị chặn: dùng mã trong bộ nhớ */
  }
  return id;
}

const CODE_FAILURE: Record<MiniErrorCode, RoundFailure> = {
  GAME_DISABLED: 'disabled',
  GAME_NO_CONTENT: 'no_content',
  ROUND_LIMIT: 'limit',
  ROUND_EXPIRED: 'expired',
  ROUND_SUBMITTED: 'already_submitted',
  ROUND_TOO_FAST: 'too_fast',
  LOGIN_REQUIRED: 'login_required',
  ROUND_NOT_FOUND: 'rejected',
  ANSWERS_INVALID: 'rejected',
  ROUND_TOKEN_INVALID: 'rejected',
};

/**
 * Mã nghiệp vụ của máy chủ thắng mã HTTP (`ROUND_LIMIT` là 429 nhưng không được gửi lại). Không có mã: mất mạng, 5xx, 408 hoặc 429 của
 * bộ chặn tần suất là lỗi tạm, gửi lại cùng đáp án an toàn vì máy chủ khoá ván bằng `submittedAt` và chỉ chấm một lần.
 */
export function classifyMiniError(err: unknown): RoundFailure {
  const code = errorCode(err);
  if (code && Object.prototype.hasOwnProperty.call(CODE_FAILURE, code)) return CODE_FAILURE[code as MiniErrorCode];
  const status = errorStatus(err);
  if (status === undefined || status >= 500 || status === 429 || status === 408) return 'network';
  return status === 404 ? 'disabled' : 'rejected';
}
