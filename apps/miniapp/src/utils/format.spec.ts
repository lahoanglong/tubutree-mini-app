import { describe, it, expect } from 'vitest';
import { formatRatePct, formatPoints, formatVndShort, formatMultiplier } from './format';

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

// Trước đây mỗi màn tự format điểm một kiểu: "1.250 điểm" (Ví), "1250 Điểm Xanh" (Điểm Xanh),
// "1250" (Cá nhân) — cùng một con số trông như ba giá trị khác nhau.
describe('formatPoints — điểm Xanh hiển thị thống nhất', () => {
  it('luôn có dấu phân cách nghìn + đơn vị', () => {
    expect(formatPoints(1250)).toBe('1.250 điểm');
  });

  it('số nhỏ vẫn giữ đúng định dạng', () => {
    expect(formatPoints(5)).toBe('5 điểm');
  });

  it('null/undefined/rác → 0 điểm, không ra NaN', () => {
    expect(formatPoints(null)).toBe('0 điểm');
    expect(formatPoints(undefined)).toBe('0 điểm');
    expect(formatPoints(Number('x'))).toBe('0 điểm');
  });
});

// Mốc rút tối thiểu và hệ số Ví Tubu đến từ config BE — FE chỉ định dạng lại, không bịa số.
describe('formatVndShort — số tiền rút gọn trong câu chữ', () => {
  it('50000 → "50k"', () => {
    expect(formatVndShort(50_000)).toBe('50k');
  });

  it('1500000 → "1,5tr" (dấu phẩy thập phân kiểu Việt)', () => {
    expect(formatVndShort(1_500_000)).toBe('1,5tr');
  });

  it('2000000 → "2tr" (bỏ ",0" thừa)', () => {
    expect(formatVndShort(2_000_000)).toBe('2tr');
  });

  it('số lẻ không tròn nghìn giữ nguyên dạng đầy đủ để không nói sai con số', () => {
    expect(formatVndShort(50_500)).toBe('50.500đ');
  });

  it('null/0 → "0đ"', () => {
    expect(formatVndShort(null)).toBe('0đ');
    expect(formatVndShort(0)).toBe('0đ');
  });
});

describe('formatMultiplier — hệ số nhân', () => {
  it('1.5 → "1,5"', () => {
    expect(formatMultiplier(1.5)).toBe('1,5');
  });

  it('2 → "2" (không có ",00")', () => {
    expect(formatMultiplier(2)).toBe('2');
  });

  it('1.25 → "1,25"', () => {
    expect(formatMultiplier(1.25)).toBe('1,25');
  });

  it('thiếu config → "1" (không nhân sai lên)', () => {
    expect(formatMultiplier(undefined)).toBe('1');
  });
});
