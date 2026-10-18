import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { createCashbackClick, getCashbackTransactions, getMerchants } from './cashback';

describe('cashback — hợp đồng gọi API', () => {
  it('đối tác, bấm đi mua, lịch sử', async () => {
    const { http, calls } = fakeHttp();
    await getMerchants(http);
    await createCashbackClick(http, 'm1', 'https://x.vn/p');
    await createCashbackClick(http, 'm1');
    await getCashbackTransactions(http);
    expect(calls).toEqual([
      { method: 'get', path: '/cashback/merchants' },
      { method: 'post', path: '/cashback/click', body: { merchantId: 'm1', productUrl: 'https://x.vn/p' } },
      { method: 'post', path: '/cashback/click', body: { merchantId: 'm1', productUrl: undefined } },
      { method: 'get', path: '/cashback/transactions' },
    ]);
  });
});
