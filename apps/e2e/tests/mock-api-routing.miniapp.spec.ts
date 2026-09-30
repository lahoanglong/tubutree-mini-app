import { test, expect, type Route } from '@playwright/test';
import type { AuthUser } from '@tubutree/shared-types';
import { MockApi, mockSession } from './support/mock-api';

/**
 * Định tuyến của MockApi (không cần trình duyệt): route cụ thể hơn thắng route có `:param`,
 * bất kể thứ tự đăng ký. Trước đây "đăng ký sau thắng" → `GET /orders/:code` đăng ký sau
 * `mockSession` nuốt luôn `GET /orders/active-count` (badge tab Đơn hàng).
 */
function fakeRoute(path: string): { route: Route; fulfilled: { status: number; body: unknown }[] } {
  const fulfilled: { status: number; body: unknown }[] = [];
  const request = {
    url: () => `http://localhost:3001/api${path}`,
    method: () => 'GET',
    headers: () => ({}),
    postData: () => null,
  };
  const route = {
    request: () => request,
    fulfill: async (o: { status: number; body: string }) => {
      fulfilled.push({ status: o.status, body: JSON.parse(o.body) });
    },
  } as unknown as Route;
  return { route, fulfilled };
}

const USER: AuthUser = {
  id: 'u1', fullName: 'Khách', role: 'CUSTOMER', referralCode: 'R1', pointsBalance: 0, walletBalance: 0, coinsBalance: 0,
};

async function send(api: MockApi, path: string) {
  const { route, fulfilled } = fakeRoute(path);
  await api.handle(route);
  return fulfilled[0]!;
}

test.describe('MockApi — route cụ thể hơn thắng route có :param', () => {
  test('/orders/:code đăng ký SAU mặc định active-count không nhận lời gọi active-count', async () => {
    const api = new MockApi();
    api.get('/orders/active-count', { count: 3 });
    api.get('/orders/:code', ({ params }) => ({ code: params.code!.toUpperCase() }));

    expect((await send(api, '/orders/active-count')).body).toEqual({ count: 3 });
    expect((await send(api, '/orders/abc')).body).toEqual({ code: 'ABC' });
    expect(api.callsTo('GET', '/orders/:code')).toHaveLength(1);
    expect(api.callsTo('GET', '/orders/active-count')).toHaveLength(1);
    expect(api.handlerErrors).toEqual([]);
  });

  test('mockSession default vẫn thắng khi /orders/:code đăng ký sau, và spec vẫn ghi đè được active-count', async () => {
    const api = new MockApi();
    mockSession(api, USER);
    api.get('/orders/:code', ({ params }) => ({ code: params.code!.toUpperCase() }));
    expect((await send(api, '/orders/active-count')).body).toEqual({ count: 0 });

    api.get('/orders/active-count', { count: 5 }); // cùng độ cụ thể → đăng ký sau thắng
    expect((await send(api, '/orders/active-count')).body).toEqual({ count: 5 });
  });
});
