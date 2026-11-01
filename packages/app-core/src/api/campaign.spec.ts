import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { fetchCampaign, fetchCampaignProducts, fetchCampaigns } from './campaign';

describe('campaign — hợp đồng gọi API', () => {
  it('danh sách theo vị trí, chi tiết theo slug, sản phẩm theo trang; công khai nên không gửi phiên', async () => {
    const { http, calls } = fakeHttp();
    await fetchCampaigns(http, 'HOME_TOP');
    await fetchCampaign(http, 'giua-thu');
    await fetchCampaignProducts(http, 'giua-thu', { page: 2, limit: 20 });
    await fetchCampaignProducts(http, 'giua-thu');
    expect(calls).toEqual([
      { method: 'get', path: '/campaigns', opts: { query: { placement: 'HOME_TOP' }, anonymous: true } },
      { method: 'get', path: '/campaigns/giua-thu', opts: { anonymous: true } },
      { method: 'get', path: '/campaigns/giua-thu/products', opts: { query: { page: 2, limit: 20 }, anonymous: true } },
      { method: 'get', path: '/campaigns/giua-thu/products', opts: { query: {}, anonymous: true } },
    ]);
  });

  it('slug có ký tự đặc biệt được mã hoá, không bẻ đường dẫn', async () => {
    const { http, calls } = fakeHttp();
    await fetchCampaign(http, 'a/b?x');
    expect(calls[0]?.path).toBe('/campaigns/a%2Fb%3Fx');
  });
});
