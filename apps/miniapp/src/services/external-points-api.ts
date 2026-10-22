import type {
  ExternalClaimRejectCode,
  MyExternalClaimsResponse,
  SubmitExternalClaimResponse,
} from '@tubutree/shared-types';
import { api } from './api';
import { isHttpError } from './http';

export type {
  ExternalClaimRejectCode,
  ExternalClaimState,
  MyExternalClaimItem,
  MyExternalClaimsResponse,
  SubmitExternalClaimResponse,
} from '@tubutree/shared-types';

export const submitExternalClaim = (code: string) =>
  api.post<SubmitExternalClaimResponse>('/me/external-points/claims', { code }).then((r) => r.data);

export const getMyExternalClaims = (page = 1, limit = 10) =>
  api.get<MyExternalClaimsResponse>('/me/external-points/claims', { params: { page, limit } }).then((r) => r.data);

const REJECT_CODES: readonly ExternalClaimRejectCode[] = [
  'DISABLED', 'NOT_ELIGIBLE_USER', 'INVALID_CODE', 'LOCKED', 'DAILY_ATTEMPTS', 'APP_ORDER', 'CHAT_ORDER', 'TOO_OLD',
  'BEFORE_SINCE', 'CLOSED', 'ALREADY_CLAIMED', 'DAILY_MAX', 'MONTHLY_CAP', 'ZERO_POINTS',
];

/** `code` ổn định mà API gắn vào lỗi từ chối; undefined khi lỗi không phải từ chối nghiệp vụ (mạng, 5xx, API cũ). */
export function externalClaimRejectCode(error: unknown): ExternalClaimRejectCode | undefined {
  if (!isHttpError(error)) return undefined;
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return REJECT_CODES.find((c) => c === code);
}
