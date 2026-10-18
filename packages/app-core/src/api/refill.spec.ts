import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { approveRefillReturn, getPendingRefillReturns, getRefillSummary, rejectRefillReturn, returnBottles } from './refill';

describe('refill — hợp đồng gọi API', () => {
  it('đổi vỏ: kèm điểm nhận đã chọn và Idempotency-Key ở header', async () => {
    const { http, calls } = fakeHttp();
    await returnBottles(http, 3, 'key-1', 'loc-2');
    expect(calls).toEqual([
      {
        method: 'post',
        path: '/refill/return',
        body: { quantity: 3, pickupLocationId: 'loc-2' },
        opts: { headers: { 'Idempotency-Key': 'key-1' } },
      },
    ]);
  });

  it('đổi vỏ chưa có điểm nào: body không có pickupLocationId', async () => {
    const { http, calls } = fakeHttp();
    await returnBottles(http, 3, 'key-1');
    expect(calls[0]).toEqual({
      method: 'post',
      path: '/refill/return',
      body: { quantity: 3 },
      opts: { headers: { 'Idempotency-Key': 'key-1' } },
    });
  });

  it('tóm tắt và duyệt/từ chối của nhân viên', async () => {
    const { http, calls } = fakeHttp();
    await getRefillSummary(http);
    await getPendingRefillReturns(http);
    await approveRefillReturn(http, 'r1');
    await approveRefillReturn(http, 'r1', 2);
    await rejectRefillReturn(http, 'r1');
    await rejectRefillReturn(http, 'r1', 'thiếu vỏ');
    expect(calls).toEqual([
      { method: 'get', path: '/refill/me' },
      { method: 'get', path: '/refill/admin/pending' },
      { method: 'post', path: '/refill/admin/r1/approve', body: {} },
      { method: 'post', path: '/refill/admin/r1/approve', body: { receivedQuantity: 2 } },
      { method: 'post', path: '/refill/admin/r1/reject', body: {} },
      { method: 'post', path: '/refill/admin/r1/reject', body: { reason: 'thiếu vỏ' } },
    ]);
  });
});
