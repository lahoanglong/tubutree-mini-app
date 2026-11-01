import { describe, expect, it } from 'vitest';
import { fakeHttp } from '../api/fake-http';
import { campaignProductsQuery, campaignQuery, campaignsQuery } from './campaign';

describe('queries/campaign — khoá và đường gọi', () => {
  it('khoá theo vị trí, slug và trang; queryFn gọi đúng endpoint', async () => {
    const { http, calls } = fakeHttp();
    const list = campaignsQuery(http, 'OFFERS_TOP');
    const one = campaignQuery(http, 'giua-thu');
    const products = campaignProductsQuery(http, 'giua-thu', 3);
    expect(list.queryKey).toEqual(['campaigns', 'OFFERS_TOP']);
    expect(one.queryKey).toEqual(['campaign', 'giua-thu']);
    expect(products.queryKey).toEqual(['campaign-products', 'giua-thu', 3]);
    await list.queryFn();
    await one.queryFn();
    await products.queryFn();
    expect(calls.map((c) => c.path)).toEqual(['/campaigns', '/campaigns/giua-thu', '/campaigns/giua-thu/products']);
    expect(calls[2]?.opts?.query).toEqual({ page: 3, limit: 20 });
  });
});
