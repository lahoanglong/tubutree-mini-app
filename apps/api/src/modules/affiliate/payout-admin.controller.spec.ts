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
