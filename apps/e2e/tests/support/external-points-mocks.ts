import type { MyExternalClaimsResponse, SubmitExternalClaimResponse } from '@tubutree/shared-types';
import { publicConfig, reply, type MockApi } from './mock-api';

/**
 * Mock cho trang /points/scan (apps/miniapp/src/pages/external-points.tsx):
 *   GET  /config/public                  loyalty.marketplaceClaimEnabled, earnPct, marketplaceEarnPct
 *   GET  /me/external-points/claims      external-claims.controller.ts (danh sách + searching)
 *   POST /me/external-points/claims      gửi mã; lỗi nghiệp vụ trả { statusCode, error, code, message }
 */
export const EMPTY_CLAIMS: MyExternalClaimsResponse = { data: [], meta: { page: 1, limit: 10, total: 0 }, searching: [] };

export function mockExternalPoints(
  api: MockApi,
  opts: { enabled?: boolean; claims?: MyExternalClaimsResponse; submit?: SubmitExternalClaimResponse | { rejectCode: string; status: number; message: string } } = {},
) {
  api.get(
    '/config/public',
    publicConfig({
      loyalty: {
        earnPct: 2,
        marketplaceEarnPct: 1,
        marketplaceClaimEnabled: opts.enabled ?? true,
        vndPerPoint: 50,
        vndPerPointRedeem: 1000,
        maxRedeemPct: 0.2,
      },
    }),
  );
  api.post('/events', { accepted: 1 });
  api.get('/me/external-points/claims', opts.claims ?? EMPTY_CLAIMS);
  const submit = opts.submit;
  if (submit) {
    api.post('/me/external-points/claims', () =>
      'rejectCode' in submit
        ? reply(submit.status, { statusCode: submit.status, error: submit.rejectCode, code: submit.rejectCode, message: submit.message })
        : submit,
    );
  }
}
