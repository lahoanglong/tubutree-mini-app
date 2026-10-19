import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { HOME_PURCHASED_LIMIT, fetchHomeMe, fetchHomePublic } from './home';

describe('home — hợp đồng gọi API', () => {
  it('request gộp công khai và cá nhân (purchasedLimit khớp kệ Mua lại)', async () => {
    const { http, calls } = fakeHttp();
    await fetchHomePublic(http);
    await fetchHomeMe(http);
    expect(HOME_PURCHASED_LIMIT).toBe(10);
    expect(calls).toEqual([
      { method: 'get', path: '/home' },
      { method: 'get', path: '/home/me', opts: { query: { purchasedLimit: 10 } } },
    ]);
  });
});
