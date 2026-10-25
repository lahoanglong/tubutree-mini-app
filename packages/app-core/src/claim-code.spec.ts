import { describe, expect, it } from 'vitest';
import cases from './claim-code-cases.json';
import { extractClaimCode, normalizeClaimCode } from './claim-code';

describe('normalizeClaimCode (cùng bộ ca với normalizeTrackingCode của API)', () => {
  it.each(cases.normalize as [string, string | null][])('%j -> %j', (input, expected) => {
    expect(normalizeClaimCode(input)).toBe(expected);
  });
  it('nhận số, từ chối kiểu khác', () => {
    expect(normalizeClaimCode(1234567890)).toBe('1234567890');
    expect(normalizeClaimCode(null)).toBeNull();
    expect(normalizeClaimCode({})).toBeNull();
  });
});

describe('extractClaimCode', () => {
  it.each(cases.extract as [string, string, string | null][])('%j -> %s %j', (input, kind, code) => {
    expect(extractClaimCode(input)).toEqual({ kind, code });
  });
  it('không ném lỗi với URL hỏng hoặc JSON hỏng', () => {
    expect(extractClaimCode('http://%zz').kind).toBe('url');
    expect(extractClaimCode('{"a": SPXVN0123456789').code).toBe('SPXVN0123456789');
  });
});
