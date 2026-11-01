import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { fetchCollectableCoupons } from './coupon-collect';

describe('coupon-collect — hợp đồng gọi API', () => {
  it('GET /coupons/collectable, không body', async () => {
    const { http, calls } = fakeHttp(() => []);
    await fetchCollectableCoupons(http);
    expect(calls).toEqual([{ method: 'get', path: '/coupons/collectable' }]);
  });
});
