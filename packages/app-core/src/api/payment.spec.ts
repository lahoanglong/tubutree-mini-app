import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { getBankQr } from './payment';

describe('payment — hợp đồng gọi API', () => {
  it('GET /payments/bank-qr/:code', async () => {
    const { http, calls } = fakeHttp();
    await getBankQr(http, 'TUBU1');
    expect(calls).toEqual([{ method: 'get', path: '/payments/bank-qr/TUBU1' }]);
  });
});
