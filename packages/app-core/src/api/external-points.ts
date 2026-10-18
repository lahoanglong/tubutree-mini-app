import type { ExternalClaimRejectCode, MyExternalClaimsResponse, SubmitExternalClaimResponse } from '@tubutree/shared-types';
import type { HttpClient } from '../http';

export const submitExternalClaim = (http: HttpClient, code: string) =>
  http.post<SubmitExternalClaimResponse>('/me/external-points/claims', { code });

export const getMyExternalClaims = (http: HttpClient, page = 1, limit = 10) =>
  http.get<MyExternalClaimsResponse>('/me/external-points/claims', { query: { page, limit } });

export const EXTERNAL_CLAIM_REJECT_CODES: readonly ExternalClaimRejectCode[] = [
  'DISABLED', 'NOT_ELIGIBLE_USER', 'INVALID_CODE', 'LOCKED', 'DAILY_ATTEMPTS', 'APP_ORDER', 'CHAT_ORDER', 'TOO_OLD',
  'BEFORE_SINCE', 'CLOSED', 'ALREADY_CLAIMED', 'DAILY_MAX', 'MONTHLY_CAP', 'ZERO_POINTS',
];

/** `code` ổn định mà API gắn vào lỗi từ chối; undefined khi không phải từ chối nghiệp vụ (mạng, 5xx, API cũ). Hàm thuần: nơi gọi tự lấy `code` từ lỗi của mình. */
export function externalClaimRejectCode(code: string | null | undefined): ExternalClaimRejectCode | undefined {
  return EXTERNAL_CLAIM_REJECT_CODES.find((c) => c === code);
}
