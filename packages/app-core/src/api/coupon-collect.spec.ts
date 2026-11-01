import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { fetchCollectableCoupons, fetchCollectableMine } from './coupon-collect';

describe('coupon-collect — hợp đồng gọi API', () => {
  it('GET /coupons/collectable, không body', async () => {
    const { http, calls } = fakeHttp(() => []);
    await fetchCollectableCoupons(http);
    expect(calls).toEqual([{ method: 'get', path: '/coupons/collectable' }]);
  });

  it('tải lại sau lỗi nhận mã gắn tham số phá cache trình duyệt', async () => {
    const { http, calls } = fakeHttp(() => []);
    await fetchCollectableCoupons(http, 1730000000000);
    expect(calls).toEqual([{ method: 'get', path: '/coupons/collectable', opts: { query: { fresh: 1730000000000 } } }]);
  });

  it('phần riêng của khách: GET /coupons/collectable/mine', async () => {
    const { http, calls } = fakeHttp(() => ({ claimed: [], newCustomerOnly: [] }));
    await fetchCollectableMine(http);
    expect(calls).toEqual([{ method: 'get', path: '/coupons/collectable/mine' }]);
  });
});
