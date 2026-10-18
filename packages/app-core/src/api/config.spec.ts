import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { getPublicConfig } from './config';

describe('config — hợp đồng gọi API', () => {
  it('GET /config/public', async () => {
    const { http, calls } = fakeHttp();
    await getPublicConfig(http);
    expect(calls).toEqual([{ method: 'get', path: '/config/public' }]);
  });
});
