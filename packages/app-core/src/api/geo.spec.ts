import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { getCommunes, getProvinces } from './geo';

describe('geo — hợp đồng gọi API', () => {
  it('tỉnh và xã', async () => {
    const { http, calls } = fakeHttp();
    await getProvinces(http);
    await getCommunes(http, '84_VN01');
    expect(calls).toEqual([
      { method: 'get', path: '/geo/provinces' },
      { method: 'get', path: '/geo/communes', opts: { query: { provinceCode: '84_VN01' } } },
    ]);
  });
});
