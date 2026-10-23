import 'reflect-metadata';
import { PayoutAdminController } from './payout-admin.controller';

describe('PayoutAdminController — báo service người bấm "Đã chi" không phải quản trị viên (D1-05)', () => {
  it.each([
    ['ADMIN', false],
    ['STAFF', true],
    ['DEALER', true],
    ['CUSTOMER', true],
  ])('role %s → byStaff %s', async (role, byStaff) => {
    const affiliate = { markPayoutPaid: jest.fn().mockResolvedValue({}) };
    await new PayoutAdminController(affiliate as never).markPaid('u-1', role, 'p-1', { bankRef: 'FT1' });
    expect(affiliate.markPayoutPaid).toHaveBeenCalledWith('u-1', 'p-1', { bankRef: 'FT1', byStaff });
  });
});

describe('PayoutAdminController — chuyển expectedAmount (số đang hiện trên màn) xuống service', () => {
  it('approve truyền expectedAmount', async () => {
    const affiliate = { approvePayout: jest.fn().mockResolvedValue({}) };
    await new PayoutAdminController(affiliate as never).approve('a-1', 'p-1', { note: 'ok', expectedAmount: 750_000 });
    expect(affiliate.approvePayout).toHaveBeenCalledWith('a-1', 'p-1', 'ok', 750_000);
  });

  it('markPaid truyền expectedAmount trong opts', async () => {
    const affiliate = { markPayoutPaid: jest.fn().mockResolvedValue({}) };
    await new PayoutAdminController(affiliate as never).markPaid('a-1', 'ADMIN', 'p-1', { bankRef: 'FT1', expectedAmount: 750_000 });
    expect(affiliate.markPayoutPaid).toHaveBeenCalledWith('a-1', 'p-1', { bankRef: 'FT1', expectedAmount: 750_000, byStaff: false });
  });
});
