import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { getMyExternalClaims, submitExternalClaim } from './external-points';

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
