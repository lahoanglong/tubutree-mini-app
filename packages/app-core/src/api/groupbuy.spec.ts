import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { createGroupBuy, getGroupBuy, joinGroupBuy, listGroupBuys } from './groupbuy';

describe('groupbuy — hợp đồng gọi API', () => {
  it('mua chung', async () => {
    const { http, calls } = fakeHttp();
    await listGroupBuys(http);
    await getGroupBuy(http, 'g1');
    await createGroupBuy(http, 'p1');
    await joinGroupBuy(http, 'g1');
    expect(calls).toEqual([
      { method: 'get', path: '/group-buy' },
      { method: 'get', path: '/group-buy/g1' },
      { method: 'post', path: '/group-buy', body: { productId: 'p1' } },
      { method: 'post', path: '/group-buy/g1/join' },
    ]);
  });
});
