import { describe, expect, it } from 'vitest';
import { isTaxCodeValid, normalizeTaxCode } from './tax-code';

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
  it('từ chối rỗng, chữ, độ dài sai', () => {
    for (const v of ['', 'abc', '12345', '01012345678', '0101234567-0']) expect(isTaxCodeValid(v)).toBe(false);
  });
});
