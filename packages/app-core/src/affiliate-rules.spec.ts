import { describe, expect, it } from 'vitest';
import {
  PERSONAL_TAX_ID_PATTERN,
  isSuggestable,
  parseTypedVnPhone,
  payoutTax,
  progressPct,
  withdrawView,
} from './affiliate-rules';

describe('PERSONAL_TAX_ID_PATTERN', () => {
  it('nhận MST 10 số, 10-3 và CCCD 12 số', () => {
    for (const ok of ['0123456789', '0123456789-001', '012345678901']) expect(PERSONAL_TAX_ID_PATTERN.test(ok)).toBe(true);
  });
  it('từ chối độ dài khác, chữ và khoảng trắng', () => {
    for (const bad of ['', '123456789', '01234567890', '0123456789-01', '01234567890a', ' 0123456789']) {
      expect(PERSONAL_TAX_ID_PATTERN.test(bad)).toBe(false);
    }
  });
});

describe('payoutTax', () => {
  const pit = { pct: 0.1, threshold: 2_000_000 };
  it('không cấu hình hoặc pct 0: không thuế', () => {
    expect(payoutTax(5_000_000, undefined)).toBe(0);
    expect(payoutTax(5_000_000, { pct: 0, threshold: 0 })).toBe(0);
  });
  it('dưới ngưỡng: không thuế; từ ngưỡng: làm tròn gross * pct', () => {
    expect(payoutTax(1_999_999, pit)).toBe(0);
    expect(payoutTax(2_000_000, pit)).toBe(200_000);
    expect(payoutTax(2_000_005, { pct: 0.1, threshold: 1 })).toBe(200_001);
  });
  it('pct lớn hơn 1 bị chặn ở 1', () => {
    expect(payoutTax(1_000, { pct: 5, threshold: 0 })).toBe(1_000);
  });
});

describe('progressPct', () => {
  it('chưa tới ngưỡng tối đa 99, tới ngưỡng 100, ngưỡng không hợp lệ 100', () => {
    expect(progressPct(9_990_000, 10_000_000)).toBe(99);
    expect(progressPct(10_000_000, 10_000_000)).toBe(100);
    expect(progressPct(0, 10_000_000)).toBe(0);
    expect(progressPct(5, 0)).toBe(100);
  });
});

describe('parseTypedVnPhone', () => {
  it('chuẩn hoá 0, +84, 84 về 0xxxxxxxxx', () => {
    expect(parseTypedVnPhone('0912 345 678')).toBe('0912345678');
    expect(parseTypedVnPhone('+84 912.345.678')).toBe('0912345678');
    expect(parseTypedVnPhone('84912345678')).toBe('0912345678');
  });
  it('từ chối thiếu số, dãy 9 số không có 0 đầu, chữ', () => {
    expect(parseTypedVnPhone('091234567')).toBeNull();
    expect(parseTypedVnPhone('912345678')).toBeNull();
    expect(parseTypedVnPhone('abc')).toBeNull();
  });
});

describe('isSuggestable', () => {
  it('cần từ 2 ký tự sau khi gấp dấu', () => {
    expect(isSuggestable('đ')).toBe(false);
    expect(isSuggestable(' a ')).toBe(false);
    expect(isSuggestable('xà')).toBe(true);
  });
});

describe('withdrawView', () => {
  const base = {
    max: 80_000,
    method: 'WALLET_BALANCE' as const,
    pit: undefined,
    taxIdOnFile: null,
    taxId: '',
    minBank: 50_000,
    cfgLoaded: true,
    knownMax: true,
    bank: { bankName: '', accountNumber: '', accountName: '' },
  };
  it('ví: hợp lệ khi có số dư, không cần ngân hàng', () => {
    expect(withdrawView(base)).toMatchObject({ valid: true, tax: 0, net: 80_000, askTaxId: false });
  });
  it('chờ config thật cho cả ví: chưa biết thuế thì số nhận trên nút có thể sai', () => {
    expect(withdrawView({ ...base, cfgLoaded: false }).valid).toBe(false);
  });
  it('không biết số dư thật (dashboard lỗi) hoặc số dư 0: không gửi được', () => {
    expect(withdrawView({ ...base, knownMax: false }).valid).toBe(false);
    expect(withdrawView({ ...base, max: 0 }).valid).toBe(false);
  });
  it('ngân hàng: chờ config thật, đủ mức tối thiểu, đủ thông tin', () => {
    const bank = { bankName: 'VCB', accountNumber: '123456', accountName: 'A' };
    expect(withdrawView({ ...base, method: 'BANK', bank, cfgLoaded: false }).valid).toBe(false);
    expect(withdrawView({ ...base, method: 'BANK', bank, minBank: 90_000 }).valid).toBe(false);
    expect(withdrawView({ ...base, method: 'BANK', bank }).valid).toBe(true);
    expect(withdrawView({ ...base, method: 'BANK', bank: { ...bank, accountNumber: '12345' } }).valid).toBe(false);
    expect(withdrawView({ ...base, method: 'BANK', bank: { ...bank, bankName: '  ' } }).valid).toBe(false);
  });
  it('có thuế và chưa khai MST: hỏi MST và chặn tới khi đúng mẫu', () => {
    const pit = { pct: 0.1, threshold: 50_000 };
    const v = withdrawView({ ...base, pit });
    expect(v).toMatchObject({ tax: 8_000, net: 72_000, askTaxId: true, taxIdValid: false, valid: false });
    expect(withdrawView({ ...base, pit, taxId: ' 0123456789 ' })).toMatchObject({ taxIdValid: true, valid: true });
  });
  it('đã khai MST: không hỏi lại', () => {
    const v = withdrawView({ ...base, pit: { pct: 0.1, threshold: 50_000 }, taxIdOnFile: '0123456789' });
    expect(v).toMatchObject({ askTaxId: false, valid: true });
  });
  it('đang gửi: không cho gửi lần hai', () => {
    expect(withdrawView({ ...base, pending: true }).valid).toBe(false);
  });
});
