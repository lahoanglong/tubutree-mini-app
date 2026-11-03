import { describe, expect, it } from 'vitest';
import { isTaxCodeValid, normalizeTaxCode, shouldShowTaxCodeError } from './tax-code';

describe('tax-code', () => {
  it('chấp nhận 10 số, 10 số + chi nhánh, 12 số CCCD', () => {
    for (const v of ['0101234567', '0101234567-001', '012345678901']) expect(isTaxCodeValid(v)).toBe(true);
  });
  it('bỏ khoảng trắng, dấu chấm; chi nhánh 13 số liền tự chèn gạch', () => {
    expect(normalizeTaxCode('0101 234 567')).toBe('0101234567');
    expect(normalizeTaxCode('0101.234.567')).toBe('0101234567');
    expect(normalizeTaxCode('0101234567001')).toBe('0101234567-001');
    expect(isTaxCodeValid('0101234567001')).toBe(true);
  });
  it('chấp nhận dạng 10-3 có khoảng trắng', () => {
    expect(isTaxCodeValid(' 0101234567 - 001 ')).toBe(true);
  });
  it('từ chối rỗng, chữ, độ dài sai', () => {
    for (const v of ['', 'abc', '12345', '01012345678', '0101234567-0', '0101234567-01', '010123456-701', '0101-234567-001']) expect(isTaxCodeValid(v)).toBe(false);
  });
  it('không báo lỗi khi mới gõ vài số, báo khi đủ 10 số mà sai hoặc có chữ', () => {
    expect(shouldShowTaxCodeError('0')).toBe(false);
    expect(shouldShowTaxCodeError('010123')).toBe(false);
    expect(shouldShowTaxCodeError('0101234567-0012')).toBe(true);
    expect(shouldShowTaxCodeError('01012345678')).toBe(false);
    expect(shouldShowTaxCodeError('0101234567-')).toBe(false);
    expect(shouldShowTaxCodeError('0101234567-0')).toBe(false);
    expect(shouldShowTaxCodeError('0101234567-00')).toBe(false);
    expect(shouldShowTaxCodeError('0101234567-00a')).toBe(true);
    expect(shouldShowTaxCodeError('01a')).toBe(true);
    expect(shouldShowTaxCodeError('0101234567')).toBe(false);
  });
});
