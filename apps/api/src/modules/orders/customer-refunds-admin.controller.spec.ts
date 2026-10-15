import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DismissOverpaymentDto, ListCustomerRefundsQuery, VerifyOverpaymentDto } from './customer-refunds-admin.controller';

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
