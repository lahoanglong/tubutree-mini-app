import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { cancelFlashReminder, fetchActiveFlashSales, fetchUpcomingFlashSales, setFlashReminder } from './flash-sale';

describe('flash-sale — hợp đồng gọi API', () => {
  it('danh sách và nhắc giờ vàng', async () => {
    const { http, calls } = fakeHttp();
    await fetchActiveFlashSales(http);
    await fetchUpcomingFlashSales(http);
    await setFlashReminder(http, 'it1');
    await cancelFlashReminder(http, 'it1');
    expect(calls).toEqual([
      { method: 'get', path: '/flash-sales/active' },
      { method: 'get', path: '/flash-sales/upcoming' },
      { method: 'post', path: '/flash-sales/items/it1/remind' },
      { method: 'delete', path: '/flash-sales/items/it1/remind' },
    ]);
  });
});
