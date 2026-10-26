import { describe, expect, it } from 'vitest';
import cases from './waste-code-cases.json';
import { extractWasteLookupCode, normalizeWasteLookupCode } from './waste-code-input';

describe('normalizeWasteLookupCode (cùng bộ ca với API)', () => {
  it.each(cases.lookup as [string, string][])('%j -> %j', (input, expected) => {
    expect(normalizeWasteLookupCode(input)).toBe(expected);
  });
});

describe('extractWasteLookupCode', () => {
  it('lấy mã trong đường dẫn hoặc đoạn chữ', () => {
    expect(extractWasteLookupCode('https://tubutree.vn/doi-rac/quay?code=TR-6NY3J')).toBe('TR-6NY3J');
    expect(extractWasteLookupCode('Mã đổi rác: tr-6ny3j.')).toBe('TR-6NY3J');
    expect(extractWasteLookupCode('QG-ABCD2345')).toBe('QG-ABCD2345');
  });
  it('mã trần không tiền tố vẫn nhận', () => {
    expect(extractWasteLookupCode('6NY3J')).toBe('TR-6NY3J');
  });
  it('không giống mã thì trả null', () => {
    expect(extractWasteLookupCode('0900123456')).toBeNull();
    expect(extractWasteLookupCode('')).toBeNull();
  });
});
