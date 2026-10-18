import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { getWallet, getWalletTransactions, withdraw } from './wallet';

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

  it('rút tiền: cùng endpoint, body { amount, bankInfo }, Idempotency-Key ở header', async () => {
    const { http, calls } = fakeHttp();
    const bankInfo = { bankName: 'VCB', accountNumber: '1', accountName: 'A' };
    await withdraw(http, 500000, bankInfo, 'key-w');
    expect(calls).toEqual([
      {
        method: 'post',
        path: '/wallet/withdraw',
        body: { amount: 500000, bankInfo },
        opts: { headers: { 'Idempotency-Key': 'key-w' } },
      },
    ]);
  });
});
