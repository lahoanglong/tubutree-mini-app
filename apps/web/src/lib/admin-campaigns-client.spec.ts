import { afterEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({})));
vi.mock('./client-api', () => ({ apiFetch }));

import {
  createAdminCampaign,
  deleteAdminCampaign,
  getAdminCampaign,
  listAdminCampaigns,
  setAdminCampaignCoupons,
  setAdminCampaignProducts,
  updateAdminCampaign,
} from './admin-campaigns-client';

afterEach(() => apiFetch.mockClear());

describe('admin-campaigns-client: đúng đường dẫn và thân gửi lên /admin/campaigns', () => {
  it('liệt kê: không lọc thì không có query; lọc vị trí thì ?placement=', async () => {
    await listAdminCampaigns();
    await listAdminCampaigns('HOME_TOP');
    expect(apiFetch.mock.calls).toEqual([['/admin/campaigns'], ['/admin/campaigns?placement=HOME_TOP']]);
  });

  it('chi tiết, tạo, sửa, xoá', async () => {
    await getAdminCampaign('c1');
    await createAdminCampaign({ title: 'A', placement: 'HOME_TOP', image: 'https://x/y.jpg', startAt: 's', endAt: 'e' });
    await updateAdminCampaign('c1', { isActive: false });
    await deleteAdminCampaign('c1');
    expect(apiFetch.mock.calls).toEqual([
      ['/admin/campaigns/c1'],
      ['/admin/campaigns', { method: 'POST', body: { title: 'A', placement: 'HOME_TOP', image: 'https://x/y.jpg', startAt: 's', endAt: 'e' } }],
      ['/admin/campaigns/c1', { method: 'PATCH', body: { isActive: false } }],
      ['/admin/campaigns/c1', { method: 'DELETE' }],
    ]);
  });

  it('đặt sản phẩm và mã là PUT thay cả danh sách', async () => {
    await setAdminCampaignProducts('c1', ['p1', 'p2']);
    await setAdminCampaignCoupons('c1', ['THU10']);
    expect(apiFetch.mock.calls).toEqual([
      ['/admin/campaigns/c1/products', { method: 'PUT', body: { productIds: ['p1', 'p2'] } }],
      ['/admin/campaigns/c1/coupons', { method: 'PUT', body: { codes: ['THU10'] } }],
    ]);
  });

  it('id có ký tự đặc biệt được mã hoá trong đường dẫn', async () => {
    await getAdminCampaign('a/b');
    expect(apiFetch.mock.calls[0]).toEqual(['/admin/campaigns/a%2Fb']);
  });
});
