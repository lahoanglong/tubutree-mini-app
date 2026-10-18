import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { followBrand, getBrandFollowState, getBrandShareToEarn, getPublicBrand, unfollowBrand } from './brand';

describe('brand — hợp đồng gọi API', () => {
  it('trang thương hiệu', async () => {
    const { http, calls } = fakeHttp();
    await getPublicBrand(http, 'tubu');
    await getBrandShareToEarn(http, 'tubu');
    await getBrandFollowState(http, 'tubu');
    await followBrand(http, 'tubu');
    await unfollowBrand(http, 'tubu');
    expect(calls).toEqual([
      { method: 'get', path: '/brand/public/tubu' },
      { method: 'get', path: '/brand/tubu/share-to-earn' },
      { method: 'get', path: '/brand/tubu/follow-state' },
      { method: 'post', path: '/brand/tubu/follow' },
      { method: 'delete', path: '/brand/tubu/follow' },
    ]);
  });
});
