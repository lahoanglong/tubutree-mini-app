import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { getOrderStatusCounts, ORDER_STATUS_COUNTS_KEY, orderStatusCountsQuery } from './order-counts';

describe('order-counts — hợp đồng gọi API', () => {
  it('getOrderStatusCounts: một GET /orders/status-counts, trả nguyên body', async () => {
    const body = { pending_payment: 1, processing: 2, shipping: 0, delivered: 7, closed: 1 };
    const { http, calls } = fakeHttp(() => body);
    await expect(getOrderStatusCounts(http)).resolves.toEqual(body);
    expect(calls).toEqual([{ method: 'get', path: '/orders/status-counts' }]);
  });

  it('khoá nằm dưới tiền tố ["orders"] để invalidate sau đặt/huỷ đơn làm mới số đếm', () => {
    expect(ORDER_STATUS_COUNTS_KEY[0]).toBe('orders');
    expect(orderStatusCountsQuery(fakeHttp().http).queryKey).toEqual(['orders', 'status-counts']);
  });
});
