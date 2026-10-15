import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PayoutDto, TaxStatementQuery } from './affiliate.controller';
import { PitReportQuery } from './payout-admin.controller';

async function errors<T extends object>(cls: new () => T, plain: object) {
  const res = await validate(plainToInstance(cls, plain));
  return res.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('SELLER-10 DTO: rút hoa hồng cần tài khoản nhận trừ khi rút về ví', () => {
  const BANK = { bankName: 'VCB', accountNumber: '0071000123456', accountName: 'NGUYEN VAN A' };

  it('mọi phương thức khác WALLET_BALANCE (kể cả ZALOPAY cũ) phải kèm bankInfo hợp lệ', async () => {
    for (const method of ['BANK', 'ZALOPAY']) {
      expect(await errors(PayoutDto, { amount: 500_000, method })).not.toEqual([]);
      expect(await errors(PayoutDto, { amount: 500_000, method, bankInfo: BANK })).toEqual([]);
    }
  });

  it('rút về ví không cần bankInfo', async () => {
    expect(await errors(PayoutDto, { amount: 500_000, method: 'WALLET_BALANCE' })).toEqual([]);
  });
});

describe('SELLER-11 DTO: MST/CCCD, năm bảng kê, tháng báo cáo', () => {
  it('MST 10 số, MST 10-3, CCCD 12 số hợp lệ; số khác báo câu tiếng Việt', async () => {
    for (const taxId of ['0123456789', '0123456789-001', '079201001234']) {
      expect(await errors(PayoutDto, { amount: 1, method: 'WALLET_BALANCE', taxId })).toEqual([]);
    }
    for (const taxId of ['12345', '07920100123', 'abc0123456789']) {
      expect(await errors(PayoutDto, { amount: 1, method: 'WALLET_BALANCE', taxId })).toEqual([
        'Mã số thuế cá nhân gồm 10 chữ số, hoặc số CCCD 12 chữ số.',
      ]);
    }
  });

  it('năm bảng kê là số trong khoảng; tháng báo cáo YYYY-MM', async () => {
    expect(await errors(TaxStatementQuery, { year: '2026' })).toEqual([]);
    expect(await errors(TaxStatementQuery, { year: '1999' })).not.toEqual([]);
    expect(await errors(PitReportQuery, { month: '2026-10' })).toEqual([]);
    expect(await errors(PitReportQuery, { month: '2026-13' })).toEqual(['Tháng phải có dạng YYYY-MM.']);
  });
});
