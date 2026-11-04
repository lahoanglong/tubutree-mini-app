import { affiliateRevocationPatch } from './admin.service';

describe('affiliateRevocationPatch', () => {
  it('CTV hoặc đại lý bị hạ về khách → đặt dấu', () => {
    expect(affiliateRevocationPatch('AFFILIATE', 'CUSTOMER').affiliateRevokedAt).toBeInstanceOf(Date);
    expect(affiliateRevocationPatch('DEALER', 'CUSTOMER').affiliateRevokedAt).toBeInstanceOf(Date);
  });
  it('cấp lại CTV hoặc đại lý → xoá dấu', () => {
    expect(affiliateRevocationPatch('CUSTOMER', 'AFFILIATE')).toEqual({ affiliateRevokedAt: null });
    expect(affiliateRevocationPatch('CUSTOMER', 'DEALER')).toEqual({ affiliateRevokedAt: null });
  });
  it('đổi sang nhân viên hoặc admin, hay khách thường thành khách → không đụng dấu', () => {
    expect(affiliateRevocationPatch('AFFILIATE', 'STAFF')).toEqual({});
    expect(affiliateRevocationPatch('AFFILIATE', 'ADMIN')).toEqual({});
    expect(affiliateRevocationPatch('STAFF', 'CUSTOMER')).toEqual({});
    expect(affiliateRevocationPatch('CUSTOMER', 'CUSTOMER')).toEqual({});
  });
});
