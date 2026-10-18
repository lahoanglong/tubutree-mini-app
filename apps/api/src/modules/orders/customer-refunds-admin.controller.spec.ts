import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CustomerRefundsAdminController,
  DismissOverpaymentDto,
  ListCustomerRefundsQuery,
  VerifyOverpaymentDto,
} from './customer-refunds-admin.controller';

async function errorsFor<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  const errs = await validate(plainToInstance(cls, plain), { whitelist: true });
  return errs.flatMap((e) => Object.keys(e.constraints ?? {}).map((k) => `${e.property}.${k}`));
}

describe('Hàng chờ Hoàn tiền khách — khoản tiền dư Pancake chờ đối soát', () => {
  it('lọc được theo "Chờ đối soát" và "Đã bỏ qua"', async () => {
    expect(await errorsFor(ListCustomerRefundsQuery, { status: 'UNVERIFIED' })).toEqual([]);
    expect(await errorsFor(ListCustomerRefundsQuery, { status: 'DISMISSED' })).toEqual([]);
    expect(await errorsFor(ListCustomerRefundsQuery, { status: 'WHATEVER' })).toContain('status.isIn');
  });

  it('R4-ADMIN-3: lọc được "Đang mở" (OPEN) — cùng tập với thẻ Hoàn tiền khách ở trang chủ', async () => {
    expect(await errorsFor(ListCustomerRefundsQuery, { status: 'OPEN' })).toEqual([]);
  });

  it('"Xác nhận tiền dư": số tiền tuỳ chọn, nếu có phải là số nguyên ≥ 1', async () => {
    expect(await errorsFor(VerifyOverpaymentDto, {})).toEqual([]);
    expect(await errorsFor(VerifyOverpaymentDto, { amount: 50_000, note: 'Sao kê VCB' })).toEqual([]);
    expect(await errorsFor(VerifyOverpaymentDto, { amount: 0 })).toContain('amount.min');
    expect(await errorsFor(VerifyOverpaymentDto, { amount: 1.5 })).toContain('amount.isInt');
  });

  it('"Không phải tiền dư": bắt buộc lý do 5..300 ký tự', async () => {
    expect(await errorsFor(DismissOverpaymentDto, {})).toContain('reason.isString');
    expect(await errorsFor(DismissOverpaymentDto, { reason: 'abc' })).toContain('reason.minLength');
    expect(await errorsFor(DismissOverpaymentDto, { reason: 'x'.repeat(301) })).toContain('reason.maxLength');
    expect(await errorsFor(DismissOverpaymentDto, { reason: 'Cùng một lần chuyển' })).toEqual([]);
  });
});

describe('CustomerRefundsAdminController — báo service người bấm là nhân viên (D1-05)', () => {
  const refunds = {
    claim: jest.fn().mockResolvedValue({}),
    verifyOverpayment: jest.fn().mockResolvedValue({}),
    dismissOverpayment: jest.fn().mockResolvedValue({}),
    markPaid: jest.fn().mockResolvedValue({}),
  };
  const ctl = new CustomerRefundsAdminController(refunds as never);

  it.each([
    ['STAFF', true],
    ['DEALER', true],
    ['ADMIN', false],
  ])('%s → byStaff=%s ở mọi thao tác ghi tiền', async (role, byStaff) => {
    await ctl.claim('u', role, 'r1', {});
    await ctl.verify('u', role, 'r1', {});
    await ctl.dismiss('u', role, 'r1', { reason: 'Cùng một lần chuyển' });
    await ctl.markPaid('u', role, 'r1', { bankRef: 'FT1' });
    for (const fn of Object.values(refunds)) {
      expect(fn).toHaveBeenLastCalledWith('u', 'r1', expect.objectContaining({ byStaff }));
    }
  });
});
