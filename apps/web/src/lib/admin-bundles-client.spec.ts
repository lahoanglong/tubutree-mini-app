import { afterEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({})));
vi.mock('./client-api', () => ({ apiFetch }));

import { createAdminBundle, deleteAdminBundle, getAdminBundle, listAdminBundles, updateAdminBundle } from './admin-bundles-client';

afterEach(() => apiFetch.mockClear());

describe('admin-bundles-client: đúng đường dẫn và thân gửi lên /admin/bundles', () => {
  it('liệt kê: không lọc thì không có query; lọc trạng thái thì ?status=', async () => {
    await listAdminBundles();
    await listAdminBundles('live');
    expect(apiFetch.mock.calls).toEqual([['/admin/bundles'], ['/admin/bundles?status=live']]);
  });

  it('chi tiết, tạo, sửa, xoá', async () => {
    const input = { kind: 'ADDON' as const, title: 'A', anchorProductId: 'p1', startAt: 's', endAt: 'e', items: [{ productId: 'p2', addonPrice: 0, maxQty: 1 }] };
    await getAdminBundle('b1');
    await createAdminBundle(input);
    await updateAdminBundle('b1', { isActive: false });
    await deleteAdminBundle('b1');
    expect(apiFetch.mock.calls).toEqual([
      ['/admin/bundles/b1'],
      ['/admin/bundles', { method: 'POST', body: input }],
      ['/admin/bundles/b1', { method: 'PATCH', body: { isActive: false } }],
      ['/admin/bundles/b1', { method: 'DELETE' }],
    ]);
  });

  it('id có ký tự đặc biệt được mã hoá trong đường dẫn', async () => {
    await getAdminBundle('a/b');
    expect(apiFetch.mock.calls[0]).toEqual(['/admin/bundles/a%2Fb']);
  });
});
