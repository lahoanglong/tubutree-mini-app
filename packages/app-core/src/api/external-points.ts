import type { ExternalClaimRejectCode, MyExternalClaimsResponse, SubmitExternalClaimResponse } from '@tubutree/shared-types';
import type { HttpClient } from '../http';

/**
 * `via`: mã do khách quét nhãn hay gõ tay (chỉ để đo phễu); bỏ trống thì gửi đúng `{ code }` như cũ. `recipientPhoneLast4` (W46): 4 số cuối SĐT
 * người nhận, chỉ gửi sau khi API trả PHONE_CONFIRM_REQUIRED cho đúng mã đó.
 */
export const submitExternalClaim = (http: HttpClient, code: string, via?: 'scan' | 'typed', recipientPhoneLast4?: string) =>
  http.post<SubmitExternalClaimResponse>('/me/external-points/claims', {
    code,
    ...(via ? { via } : {}),
    ...(recipientPhoneLast4 ? { recipientPhoneLast4 } : {}),
  });

/** W59: dòng lịch sử để nhập lại 4 số cuối: claim REVIEW có `phoneRetry`, hoặc lượt quét trong `needsPhone`. */
export type PhoneRetryTarget = { claimId: string } | { attemptId: string };

/** W59: nhập 4 số cuối SĐT người nhận từ dòng lịch sử, không quét lại. Lỗi PHONE_CONFIRM_* giống `submitExternalClaim`. */
export const retryExternalClaimPhone = (http: HttpClient, target: PhoneRetryTarget, recipientPhoneLast4: string) =>
  http.post<SubmitExternalClaimResponse>('/me/external-points/claims/phone-retry', { ...target, recipientPhoneLast4 });

export const getMyExternalClaims = (http: HttpClient, page = 1, limit = 10) =>
  http.get<MyExternalClaimsResponse>('/me/external-points/claims', { query: { page, limit } });

export const EXTERNAL_CLAIM_REJECT_CODES: readonly ExternalClaimRejectCode[] = [
  'DISABLED', 'NOT_ELIGIBLE_USER', 'INVALID_CODE', 'LOCKED', 'DAILY_ATTEMPTS', 'APP_ORDER', 'CHAT_ORDER', 'TOO_OLD',
  'BEFORE_SINCE', 'CLOSED', 'ALREADY_CLAIMED', 'DAILY_MAX', 'MONTHLY_CAP', 'ZERO_POINTS', 'PHONE_MISMATCH',
  'PHONE_CONFIRM_REQUIRED', 'PHONE_CONFIRM_WRONG', 'PHONE_CONFIRM_LOCKED',
];

/** `code` ổn định mà API gắn vào lỗi từ chối; undefined khi không phải từ chối nghiệp vụ (mạng, 5xx, API cũ). Hàm thuần: nơi gọi tự lấy `code` từ lỗi của mình. */
export function externalClaimRejectCode(code: string | null | undefined): ExternalClaimRejectCode | undefined {
  return EXTERNAL_CLAIM_REJECT_CODES.find((c) => c === code);
}

export type PhoneConfirmCode = 'PHONE_CONFIRM_REQUIRED' | 'PHONE_CONFIRM_WRONG' | 'PHONE_CONFIRM_LOCKED';

/** Lỗi gửi mã cần khách xác nhận 4 số cuối SĐT người nhận (W46): mã lỗi, sàn của đơn, lượt nhập sai còn lại (null khi API không gửi). */
export interface PhoneConfirmPrompt {
  code: PhoneConfirmCode;
  channel: string | null;
  remainingAttempts: number | null;
}

const PHONE_CONFIRM_CODES: readonly string[] = ['PHONE_CONFIRM_REQUIRED', 'PHONE_CONFIRM_WRONG', 'PHONE_CONFIRM_LOCKED'];

/**
 * Đọc thân lỗi của `POST /me/external-points/claims`: PHONE_CONFIRM_* thì trả thông tin cho màn xác nhận, còn lại null. Hàm thuần: nơi gọi tự lấy
 * thân lỗi của client mình (web `ApiError.body`, Mini `error.response.data`). Giá trị lạ (sàn không phải chuỗi ngắn, lượt âm) bị bỏ, không đoán.
 */
export function phoneConfirmPrompt(body: unknown): PhoneConfirmPrompt | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { code?: unknown; channel?: unknown; remainingAttempts?: unknown };
  if (typeof b.code !== 'string' || !PHONE_CONFIRM_CODES.includes(b.code)) return null;
  const channel = typeof b.channel === 'string' && /^[a-z][a-z0-9_]{0,19}$/.test(b.channel) ? b.channel : null;
  const n = b.remainingAttempts;
  const remainingAttempts = typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 9 ? n : null;
  return { code: b.code as PhoneConfirmCode, channel, remainingAttempts };
}
