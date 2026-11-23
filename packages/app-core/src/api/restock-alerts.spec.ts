import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { fetchMyRestockAlerts, fetchRestockStatus, myRestockAlertsKey, restockStatusKey, subscribeRestock, unsubscribeRestock } from './restock-alerts';

describe('restock-alerts — hợp đồng gọi API', () => {
  it('trạng thái: khách đã đăng nhập gửi kèm phiên, khách chưa đăng nhập gọi ẩn danh', async () => {
    const { http, calls } = fakeHttp();
    await fetchRestockStatus(http, 'p1', { anonymous: false });
    await fetchRestockStatus(http, 'p1', { anonymous: true });
    expect(calls).toEqual([
      { method: 'get', path: '/restock-alerts', opts: { query: { productId: 'p1' } } },
      { method: 'get', path: '/restock-alerts', opts: { query: { productId: 'p1' }, anonymous: true } },
    ]);
  });

  it('đăng ký và huỷ theo phân loại', async () => {
    const { http, calls } = fakeHttp();
    await subscribeRestock(http, 'v1');
    await unsubscribeRestock(http, 'v/1');
    expect(calls).toEqual([
      { method: 'post', path: '/me/restock-alerts', body: { variationId: 'v1' } },
      { method: 'delete', path: '/me/restock-alerts/v%2F1' },
    ]);
  });

  it('khoá cache tách bản có phiên và bản khách', () => {
    expect(restockStatusKey('p1', true)).toEqual(['restock-alerts', 'p1', 'me']);
    expect(restockStatusKey('p1', false)).toEqual(['restock-alerts', 'p1', 'guest']);
  });

  it('danh sách của khách: GET /me/restock-alerts có phiên (không ẩn danh), khoá chung tiền tố nhưng không trùng khoá sản phẩm', async () => {
    const { http, calls } = fakeHttp();
    await fetchMyRestockAlerts(http);
    expect(calls).toEqual([{ method: 'get', path: '/me/restock-alerts' }]);
    expect(myRestockAlertsKey[0]).toBe(restockStatusKey('p1', true)[0]);
    expect(myRestockAlertsKey).toEqual(['restock-alerts', '@me']);
  });
});
