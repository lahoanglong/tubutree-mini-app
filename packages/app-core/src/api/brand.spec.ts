import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { fetchBrandProducts, followBrand, getBrandFollowState, getBrandShareToEarn, getPublicBrand, unfollowBrand, type BrandView } from './brand';

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

  it('fetchBrandProducts: GET /brand/public/:slug/products với page, limit, sort; bỏ khoá không có giá trị', async () => {
    const { http, calls } = fakeHttp();
    await fetchBrandProducts(http, 'tubu', { page: 2, limit: 12, sort: 'newest' });
    await fetchBrandProducts(http, 'tubu', { page: 1 });
    await fetchBrandProducts(http, 'tubu');
    expect(calls).toEqual([
      { method: 'get', path: '/brand/public/tubu/products', opts: { query: { page: 2, limit: 12, sort: 'newest' } } },
      { method: 'get', path: '/brand/public/tubu/products', opts: { query: { page: 1 } } },
      { method: 'get', path: '/brand/public/tubu/products', opts: { query: {} } },
    ]);
  });

  it('fetchBrandProducts mã hoá slug để một tham số lạ không đổi đường dẫn', async () => {
    const { http, calls } = fakeHttp();
    await fetchBrandProducts(http, '../auth/me');
    expect(calls[0]!.path).toBe('/brand/public/..%2Fauth%2Fme/products');
  });

  it('BrandView.productCount là tuỳ chọn: API cũ và bản cache cũ không trả (kiểm bằng typecheck)', () => {
    const cu: Pick<BrandView, 'productCount'> = {};
    const moi: Pick<BrandView, 'productCount'> = { productCount: 57 };
    expect(cu.productCount).toBeUndefined();
    expect(moi.productCount).toBe(57);
  });
});
