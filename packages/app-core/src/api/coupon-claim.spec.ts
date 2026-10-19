import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { claimCoupon } from './coupon-claim';

describe('coupon-claim — hợp đồng gọi API', () => {
  it('POST /coupons/claim', async () => {
    const { http, calls } = fakeHttp();
    await claimCoupon(http, 'TUBU30');
    expect(calls).toEqual([{ method: 'post', path: '/coupons/claim', body: { code: 'TUBU30' } }]);
  });
});
