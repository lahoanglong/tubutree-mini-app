import { loadPublicVisibility } from './public-visibility';
import { publicStorefrontWhere } from './storefront-visibility';
import { resolvePublishedStorefront } from './resolve-storefront';

const VISIBILITY = { eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: false } as const;

describe('resolvePublishedStorefront', () => {
  it('không có chuỗi định danh → null, không truy vấn', async () => {
    const findFirst = jest.fn();
    expect(await resolvePublishedStorefront({ storefront: { findFirst } } as any, VISIBILITY, '  ')).toBeNull();
    expect(await resolvePublishedStorefront({ storefront: { findFirst } } as any, VISIBILITY, undefined)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('tra slug, subdomain, tên miền riêng đã hạ chữ và chỉ lấy gian hàng khách thấy được', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 's1', slug: 'linh', type: 'CTV', ownerUserId: 'u1' });
    const out = await resolvePublishedStorefront({ storefront: { findFirst } } as any, VISIBILITY, ' LINH ');
    expect(out).toEqual({ id: 's1', slug: 'linh', type: 'CTV', ownerUserId: 'u1' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { ...publicStorefrontWhere(VISIBILITY), OR: [{ slug: 'linh' }, { subdomain: 'linh' }, { customDomain: 'linh' }] },
      select: { id: true, slug: true, type: true, ownerUserId: true },
    });
  });

  it('cờ duyệt bật thì điều kiện duyệt đi theo vào truy vấn', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    await resolvePublishedStorefront({ storefront: { findFirst } } as any, { ...VISIBILITY, requireApproval: true }, 'linh');
    const where = findFirst.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ OR: [{ approvedAt: { not: null } }, { type: { not: 'CTV' } }, { isPartner: true }] });
  });
});

describe('loadPublicVisibility', () => {
  const config = (values: Record<string, unknown>) => ({ get: async (k: string, fb?: unknown) => (k in values ? values[k] : fb) }) as any;

  it('mặc định: CTV + đại lý, không bắt duyệt', async () => {
    expect(await loadPublicVisibility(config({}))).toEqual({ eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: false });
  });

  it('đọc khoá vai trò và cờ duyệt từ cấu hình; cờ lạ không mở', async () => {
    const out = await loadPublicVisibility(config({ 'affiliate.commission_eligible_roles': ['AFFILIATE'], 'storefront.require_approval': true }));
    expect(out).toEqual({ eligibleRoles: ['AFFILIATE'], requireApproval: true });
    expect((await loadPublicVisibility(config({ 'storefront.require_approval': 'true' }))).requireApproval).toBe(false);
  });
});
