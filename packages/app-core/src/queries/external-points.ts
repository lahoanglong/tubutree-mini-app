import type { HttpClient } from '../http';
import { getMyExternalClaims } from '../api/external-points';

export const externalClaimsQuery = (http: HttpClient, page: number, limit: number) => ({
  queryKey: ['external-claims', page] as const,
  queryFn: () => getMyExternalClaims(http, page, limit),
});
