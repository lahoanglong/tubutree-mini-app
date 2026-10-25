import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import * as wallet from './wallet';
import { getWallet, getWalletTransactions } from './wallet';

describe('wallet — hợp đồng gọi API', () => {
  it('số dư và sao kê (limit mặc định 20)', async () => {
    const { http, calls } = fakeHttp();
    await getWallet(http);
    await getWalletTransactions(http, 2);
    await getWalletTransactions(http, 1, 50);
    expect(calls).toEqual([
      { method: 'get', path: '/me/wallet' },
      { method: 'get', path: '/me/wallet/transactions', opts: { query: { page: 2, limit: 20 } } },
      { method: 'get', path: '/me/wallet/transactions', opts: { query: { page: 1, limit: 50 } } },
    ]);
  });

  it('không còn hàm rút tiền (API trả 410)', () => {
    expect(wallet).not.toHaveProperty('withdraw');
  });
});
