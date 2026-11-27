import type {
  ExternalClaimRejectCode,
  MyExternalClaimsResponse,
  SubmitExternalClaimResponse,
} from '@tubutree/shared-types';
import { phoneConfirmPrompt, type PhoneConfirmPrompt } from '@tubutree/app-core/api/external-points';
import { api } from './api';
import { isHttpError } from './http';

export type {
  ExternalClaimRejectCode,
  ExternalClaimState,
  MyExternalClaimItem,
  MyExternalClaimsResponse,
  SubmitExternalClaimResponse,
} from '@tubutree/shared-types';

/** `recipientPhoneLast4` (W46): 4 số cuối SĐT người nhận, chỉ gửi lại sau khi API trả PHONE_CONFIRM_REQUIRED cho đúng mã đó. */
export const submitExternalClaim = (code: string, via?: 'scan' | 'typed', recipientPhoneLast4?: string) =>
  api
    .post<SubmitExternalClaimResponse>('/me/external-points/claims', {
      code,
      ...(via ? { via } : {}),
      ...(recipientPhoneLast4 ? { recipientPhoneLast4 } : {}),
    })
    .then((r) => r.data);

export const getMyExternalClaims = (page = 1, limit = 10) =>
  api.get<MyExternalClaimsResponse>('/me/external-points/claims', { params: { page, limit } }).then((r) => r.data);

const REJECT_CODES: readonly ExternalClaimRejectCode[] = [
  'DISABLED', 'NOT_ELIGIBLE_USER', 'INVALID_CODE', 'LOCKED', 'DAILY_ATTEMPTS', 'APP_ORDER', 'CHAT_ORDER', 'TOO_OLD',
  'BEFORE_SINCE', 'CLOSED', 'ALREADY_CLAIMED', 'DAILY_MAX', 'MONTHLY_CAP', 'ZERO_POINTS', 'PHONE_MISMATCH',
  'PHONE_CONFIRM_REQUIRED', 'PHONE_CONFIRM_WRONG', 'PHONE_CONFIRM_LOCKED',
];

/** `code` ổn định mà API gắn vào lỗi từ chối; undefined khi lỗi không phải từ chối nghiệp vụ (mạng, 5xx, API cũ). */
export function externalClaimRejectCode(error: unknown): ExternalClaimRejectCode | undefined {
  if (!isHttpError(error)) return undefined;
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return REJECT_CODES.find((c) => c === code);
}

/** Lỗi gửi mã cần khách xác nhận 4 số cuối SĐT người nhận (W46): mã, sàn, lượt còn lại; null khi không phải lỗi đó. */
export function externalClaimPhoneConfirm(error: unknown): PhoneConfirmPrompt | null {
  if (!isHttpError(error)) return null;
  return phoneConfirmPrompt(error.response?.data);
}
