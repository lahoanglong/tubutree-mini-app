import 'reflect-metadata';
import { MerchantAdminController } from './merchant-admin.controller';

describe('MerchantAdminController — báo service người bấm "Đã chi" không phải quản trị viên (D1-05)', () => {
  it.each([
    ['ADMIN', false],
    ['STAFF', true],
    ['DEALER', true],
  ])('role %s → byStaff %s', async (role, byStaff) => {
    const fulfilment = { markPayoutPaid: jest.fn().mockResolvedValue({}) };
    await new MerchantAdminController(fulfilment as never).markPaid('u-1', role, 'mp-1', { bankRef: 'FT1' });
    expect(fulfilment.markPayoutPaid).toHaveBeenCalledWith('u-1', 'mp-1', 'FT1', { byStaff });
  });
});
