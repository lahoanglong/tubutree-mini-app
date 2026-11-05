import { afterEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({})));
vi.mock('./client-api', () => ({ apiFetch }));

import {
  checkAdminCampaign,
  createAdminCampaign,
  deleteAdminCampaign,
  getAdminCampaign,
  listAdminCampaigns,
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

  it('id có ký tự đặc biệt được mã hoá trong đường dẫn', async () => {
    await getAdminCampaign('a/b');
    expect(apiFetch.mock.calls[0]).toEqual(['/admin/campaigns/a%2Fb']);
  });
});

describe('admin-campaigns-client: kiểm trước khi bật', () => {
  it('POST /admin/campaigns/check với thân form', async () => {
    const body = {
      placement: 'HOME_TOP' as const,
      linkType: 'CAMPAIGN_PAGE' as const,
      audience: 'ALL' as const,
      startAt: 's',
      endAt: 'e',
      sortOrder: 0,
      productIds: ['p1'],
      couponCodes: [],
    };
    await checkAdminCampaign(body);
    expect(apiFetch.mock.calls).toEqual([['/admin/campaigns/check', { method: 'POST', body }]]);
  });
});
