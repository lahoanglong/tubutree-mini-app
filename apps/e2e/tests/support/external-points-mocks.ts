import type { MyExternalClaimsResponse, SubmitExternalClaimResponse } from '@tubutree/shared-types';
import { publicConfig, reply, type MockApi } from './mock-api';

/**
 * Mock cho trang /points/scan (apps/miniapp/src/pages/external-points.tsx):
 *   GET  /config/public                  loyalty.marketplaceClaimEnabled, earnPct, marketplaceEarnPct
 *   GET  /me/external-points/claims      external-claims.controller.ts (danh sách + searching)
 *   POST /me/external-points/claims      gửi mã; lỗi nghiệp vụ trả { statusCode, error, code, message }
 */
export const EMPTY_CLAIMS: MyExternalClaimsResponse = { data: [], meta: { page: 1, limit: 10, total: 0 }, searching: [] };

/** Lỗi nghiệp vụ của POST: `extra` là các trường thêm vào thân lỗi (W46 PHONE_CONFIRM_*: channel, requiredDigits, remainingAttempts). */
export interface ExternalClaimRejectMock {
  rejectCode: string;
  status: number;
  message: string;
  extra?: Record<string, unknown>;
}
type SubmitMock = SubmitExternalClaimResponse | ExternalClaimRejectMock;

/**
 * `submit` là một câu trả lời cho mọi lần gửi, hoặc một dãy trả lần lượt (lần thứ n nhận phần tử n, hết dãy thì lặp phần tử cuối), để dựng
 * luồng nhiều bước như hỏi 4 số cuối SĐT rồi gửi lại.
 */
export function mockExternalPoints(api: MockApi, opts: { enabled?: boolean; claims?: MyExternalClaimsResponse; submit?: SubmitMock | readonly SubmitMock[] } = {}) {
  api.get(
    '/config/public',
    publicConfig({
      loyalty: {
        earnPct: 2,
        marketplaceEarnPct: 1,
        marketplaceClaimEnabled: opts.enabled ?? true,
        vndPerPoint: 50,
        vndPerPointRedeem: 1,
        maxRedeemPct: 0.2,
      },
    }),
  );
  api.post('/events', { accepted: 1 });
  api.get('/me/external-points/claims', opts.claims ?? EMPTY_CLAIMS);
  const submit = opts.submit;
  if (!submit) return;
  const steps: readonly SubmitMock[] = Array.isArray(submit) ? submit : [submit as SubmitMock];
  let n = 0;
  api.post('/me/external-points/claims', () => {
    const step = steps[Math.min(n++, steps.length - 1)]!;
    return 'rejectCode' in step
      ? reply(step.status, { statusCode: step.status, error: step.rejectCode, code: step.rejectCode, message: step.message, ...step.extra })
      : step;
  });
}
