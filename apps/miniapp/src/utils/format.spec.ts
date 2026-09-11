import { describe, it, expect } from 'vitest';
import { formatRatePct } from './format';

// Seed lưu baseRate dạng phân số: Shopee 0.035, Lazada 0.042, TikTok 0.049.
describe('formatRatePct — tỉ lệ hoàn tiền (DB lưu phân số, hiển thị phần trăm)', () => {
  it('0.035 → "3,5%" (KHÔNG phải "0.035%")', () => {
    expect(formatRatePct(0.035)).toBe('3,5%');
  });

  it('nhận cả chuỗi (Decimal serialize thành string qua API)', () => {
    expect(formatRatePct('0.042')).toBe('4,2%');
  });

  it('số tròn → bỏ phần thập phân: 0.05 → "5%"', () => {
    expect(formatRatePct(0.05)).toBe('5%');
  });

  it('0 / null / undefined / rác → "0%" (không hiện NaN%)', () => {
    expect(formatRatePct(0)).toBe('0%');
    expect(formatRatePct(null)).toBe('0%');
    expect(formatRatePct(undefined)).toBe('0%');
    expect(formatRatePct('abc')).toBe('0%');
  });
});
