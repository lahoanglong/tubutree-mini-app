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

describe('CustomerRefundsAdminController — che SĐT và số trong ghi chú với người không thấy SĐT đầy đủ', () => {
  const row = { id: 'r1', phone: '0911222333', adminNote: 'Khách gọi 0988 777 666 xin hoàn', bankAccountNo: '0099887766', bankAccountName: 'KHACH A' };
  const make = () => {
    const refunds = {
      list: jest.fn().mockResolvedValue({ data: [row], meta: { total: 1 } }),
      claim: jest.fn().mockResolvedValue(row),
      release: jest.fn().mockResolvedValue(row),
      verifyOverpayment: jest.fn().mockResolvedValue(row),
      dismissOverpayment: jest.fn().mockResolvedValue(row),
      markPaid: jest.fn().mockResolvedValue(row),
    };
    return new CustomerRefundsAdminController(refunds as never);
  };
  const ketoan = { sub: 's1', role: 'STAFF', staffPermissions: ['KE_TOAN'] } as never;
  const both = { sub: 's2', role: 'STAFF', staffPermissions: ['KE_TOAN', 'CSKH'] } as never;
  const admin = { sub: 'a1', role: 'ADMIN' } as never;

  it('danh sách: KE_TOAN một mình chỉ thấy 3 số cuối, tài khoản ngân hàng giữ đủ; ADMIN và KE_TOAN kiêm CSKH thấy đủ', async () => {
    const ctl = make();
    const masked = (await ctl.list({ page: 1, limit: 20 } as never, ketoan)) as { data: (typeof row)[] };
    expect(masked.data[0]).toMatchObject({ phone: '*******333', bankAccountNo: '0099887766', bankAccountName: 'KHACH A' });
    expect(masked.data[0]!.adminNote).not.toContain('0988 777 666');
    expect(masked.data[0]!.adminNote).toContain('666');
    for (const v of [admin, both]) {
      const full = (await ctl.list({ page: 1, limit: 20 } as never, v)) as { data: (typeof row)[] };
      expect(full.data[0]).toMatchObject({ phone: '0911222333', adminNote: row.adminNote });
    }
  });

  it('mọi thao tác ghi trả về cũng che cho KE_TOAN, đủ cho ADMIN', async () => {
    const ctl = make();
    const calls = [
      (v: never) => ctl.claim('s1', 'STAFF', 'r1', {}, v),
      (v: never) => ctl.release('s1', 'r1', {}, v),
      (v: never) => ctl.verify('s1', 'STAFF', 'r1', {}, v),
      (v: never) => ctl.dismiss('s1', 'STAFF', 'r1', { reason: 'Cùng một lần chuyển' }, v),
      (v: never) => ctl.markPaid('s1', 'STAFF', 'r1', { bankRef: 'FT1' }, v),
    ];
    for (const call of calls) {
      expect(await call(ketoan)).toMatchObject({ phone: '*******333' });
      expect(await call(admin)).toMatchObject({ phone: '0911222333' });
    }
  });

  it('ghi chú: số tiền và mã giao dịch ngân hàng còn nguyên, SĐT viết trong chữ vẫn bị che', async () => {
    const note = 'xác nhận 10.000.000đ/12.500.000đ mã FT26270123456789, gọi 0988 777 666 hoặc 0912345678';
    const refunds = { list: jest.fn().mockResolvedValue({ data: [{ id: 'r1', phone: null, adminNote: note }], meta: {} }) };
    const out = (await new CustomerRefundsAdminController(refunds as never).list({ page: 1, limit: 20 } as never, { sub: 's1', role: 'STAFF', staffPermissions: ['KE_TOAN'] } as never)) as { data: { adminNote: string }[] };
    const masked = out.data[0]!.adminNote;
    expect(masked).toContain('10.000.000đ/12.500.000đ');
    expect(masked).toContain('FT26270123456789');
    expect(masked).not.toContain('0988 777');
    expect(masked).not.toContain('0912345');
    expect(masked).toContain('666');
    expect(masked).toContain('678');
  });
});
