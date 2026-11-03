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
      where: { ...publicStorefrontWhere(VISIBILITY), isSample: false, slug: 'linh' },
      select: { id: true, slug: true, type: true, ownerUserId: true },
    });
  });

  it('slug thắng subdomain thắng tên miền riêng: chỉ hỏi cột sau khi cột trước không có (DLSF-01)', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 's3', slug: 'x', type: 'CTV', ownerUserId: null });
    const out = await resolvePublishedStorefront({ storefront: { findFirst } } as any, VISIBILITY, 'linh');
    expect(out?.id).toBe('s3');
    expect(findFirst.mock.calls.map((c) => Object.keys(c[0].where).filter((k) => ['slug', 'subdomain', 'customDomain'].includes(k))[0])).toEqual(['slug', 'subdomain', 'customDomain']);
  });

  it('gian hàng mẫu không bao giờ được ghi công', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    await resolvePublishedStorefront({ storefront: { findFirst } } as any, VISIBILITY, 'mebimla');
    expect(findFirst.mock.calls[0][0].where.isSample).toBe(false);
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

  it('mặc định: CTV + đại lý, bắt duyệt lần đầu', async () => {
    expect(await loadPublicVisibility(config({}))).toEqual({ eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: true });
  });

  it('đọc khoá vai trò và cờ duyệt từ cấu hình; cờ lạ không mở', async () => {
    const out = await loadPublicVisibility(config({ 'affiliate.commission_eligible_roles': ['AFFILIATE'], 'storefront.require_approval': true }));
    expect(out).toEqual({ eligibleRoles: ['AFFILIATE'], requireApproval: true });
    expect((await loadPublicVisibility(config({ 'storefront.require_approval': 'true' }))).requireApproval).toBe(false);
  });
});
