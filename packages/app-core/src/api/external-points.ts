import type { MyExternalClaimsResponse, SubmitExternalClaimResponse } from '@tubutree/shared-types';
import type { HttpClient } from '../http';

export const submitExternalClaim = (http: HttpClient, code: string) =>
  http.post<SubmitExternalClaimResponse>('/me/external-points/claims', { code });

export const getMyExternalClaims = (http: HttpClient, page = 1, limit = 10) =>
  http.get<MyExternalClaimsResponse>('/me/external-points/claims', { query: { page, limit } });
