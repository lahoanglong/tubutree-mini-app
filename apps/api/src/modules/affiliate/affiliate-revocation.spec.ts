import { affiliateRevocationPatch, isAffiliateBlocked } from './affiliate-revocation';

const db = (opts: { commission?: boolean; storefront?: boolean } = {}) =>
  ({
    commission: { findFirst: jest.fn().mockResolvedValue(opts.commission ? { id: 'c' } : null) },
    storefront: { findFirst: jest.fn().mockResolvedValue(opts.storefront ? { id: 's' } : null) },
  }) as never;

describe('affiliateRevocationPatch', () => {
  it('CTV hoặc đại lý bị hạ về khách → đặt dấu, không cần tra dấu vết', async () => {
    const d = db();
    expect((await affiliateRevocationPatch(d, 'u', 'AFFILIATE', 'CUSTOMER')).affiliateRevokedAt).toBeInstanceOf(Date);
    expect((await affiliateRevocationPatch(d, 'u', 'DEALER', 'CUSTOMER')).affiliateRevokedAt).toBeInstanceOf(Date);
  });
  it('nhân viên/admin về khách: đặt dấu khi còn hoa hồng hoặc gian hàng CTV, không thì thôi', async () => {
    expect((await affiliateRevocationPatch(db({ commission: true }), 'u', 'STAFF', 'CUSTOMER')).affiliateRevokedAt).toBeInstanceOf(Date);
    expect((await affiliateRevocationPatch(db({ storefront: true }), 'u', 'ADMIN', 'CUSTOMER')).affiliateRevokedAt).toBeInstanceOf(Date);
    expect(await affiliateRevocationPatch(db(), 'u', 'STAFF', 'CUSTOMER')).toEqual({});
  });
  it('cấp lại CTV hoặc đại lý → xoá dấu', async () => {
    expect(await affiliateRevocationPatch(db(), 'u', 'CUSTOMER', 'AFFILIATE')).toEqual({ affiliateRevokedAt: null });
    expect(await affiliateRevocationPatch(db(), 'u', 'STAFF', 'DEALER')).toEqual({ affiliateRevokedAt: null });
  });
  it('đổi sang nhân viên/admin hoặc khách thành khách → không đụng dấu', async () => {
    expect(await affiliateRevocationPatch(db(), 'u', 'AFFILIATE', 'STAFF')).toEqual({});
    expect(await affiliateRevocationPatch(db(), 'u', 'AFFILIATE', 'ADMIN')).toEqual({});
    expect(await affiliateRevocationPatch(db({ commission: true }), 'u', 'CUSTOMER', 'CUSTOMER')).toEqual({});
  });
});

describe('isAffiliateBlocked', () => {
  it('có dấu hoặc là khách → chặn; nhân viên, admin, CTV, đại lý không dấu → qua', () => {
    expect(isAffiliateBlocked({ role: 'AFFILIATE', affiliateRevokedAt: new Date() })).toBe(true);
    expect(isAffiliateBlocked({ role: 'CUSTOMER', affiliateRevokedAt: null })).toBe(true);
    for (const role of ['STAFF', 'ADMIN', 'AFFILIATE', 'DEALER']) expect(isAffiliateBlocked({ role, affiliateRevokedAt: null })).toBe(false);
  });
});
