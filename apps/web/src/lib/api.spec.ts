import { describe, it, expect } from 'vitest';
import { formatSold, formatVnd } from './api';

describe('formatVnd', () => {
  it('format số nguyên kèm đ, phân cách nghìn kiểu VN', () => {
    expect(formatVnd(1_000_000)).toBe('1.000.000đ');
  });
});

describe('formatSold — kiểu Shopee', () => {
  it('null/undefined/0/âm → ẩn (null)', () => {
    expect(formatSold(null)).toBeNull();
    expect(formatSold(undefined)).toBeNull();
    expect(formatSold(0)).toBeNull();
    expect(formatSold(-5)).toBeNull();
  });

  it('< 1000 → hiện số thật', () => {
    expect(formatSold(1)).toBe('Đã bán 1');
    expect(formatSold(999)).toBe('Đã bán 999');
  });

  it('≥ 1000 và < 1 triệu → rút gọn "k+", bỏ .0 thừa', () => {
    expect(formatSold(1000)).toBe('Đã bán 1k+');
    expect(formatSold(1200)).toBe('Đã bán 1,2k+');
  });

  it('biên 999.999 (sát 1 triệu) → toFixed(1) làm tròn thành "1000k+" thay vì nhảy sang "1tr+" (quirk hiện tại, không phải bug chặn)', () => {
    expect(formatSold(999_999)).toBe('Đã bán 1000k+');
  });

  it('≥ 1 triệu → rút gọn "tr+"', () => {
    expect(formatSold(1_000_000)).toBe('Đã bán 1tr+');
    expect(formatSold(2_500_000)).toBe('Đã bán 2,5tr+');
  });

  it('NaN/không phải số hữu hạn → ẩn (null)', () => {
    expect(formatSold(Number.NaN)).toBeNull();
  });
});
