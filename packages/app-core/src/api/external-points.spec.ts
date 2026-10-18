import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { EXTERNAL_CLAIM_REJECT_CODES, externalClaimRejectCode, getMyExternalClaims, submitExternalClaim } from './external-points';

describe('external-points — hợp đồng gọi API', () => {
  it('gửi mã và xem lịch sử (mặc định trang 1, 10 dòng)', async () => {
    const { http, calls } = fakeHttp();
    await submitExternalClaim(http, 'SPXVN123');
    await getMyExternalClaims(http);
    await getMyExternalClaims(http, 3, 5);
    expect(calls).toEqual([
      { method: 'post', path: '/me/external-points/claims', body: { code: 'SPXVN123' } },
      { method: 'get', path: '/me/external-points/claims', opts: { query: { page: 1, limit: 10 } } },
      { method: 'get', path: '/me/external-points/claims', opts: { query: { page: 3, limit: 5 } } },
    ]);
  });
});

describe('externalClaimRejectCode', () => {
  it('nhận mọi mã từ chối đã biết', () => {
    for (const c of EXTERNAL_CLAIM_REJECT_CODES) expect(externalClaimRejectCode(c)).toBe(c);
    expect(EXTERNAL_CLAIM_REJECT_CODES).toHaveLength(14);
  });
  it('mã lạ, rỗng, null đều trả undefined', () => {
    expect(externalClaimRejectCode('WHATEVER')).toBeUndefined();
    expect(externalClaimRejectCode('')).toBeUndefined();
    expect(externalClaimRejectCode(null)).toBeUndefined();
    expect(externalClaimRejectCode(undefined)).toBeUndefined();
  });
});
