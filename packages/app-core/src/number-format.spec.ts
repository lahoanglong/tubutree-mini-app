import { describe, expect, it } from 'vitest';
import { formatMultiplier, formatVnNumber, multiplierLabel, tierPerkLabel } from './number-format';

describe('số kiểu Việt dùng chung', () => {
  it('formatVnNumber luôn có dấu chấm nghìn, rác thành 0', () => {
    expect(formatVnNumber(1000)).toBe('1.000');
    expect(formatVnNumber(17016)).toBe('17.016');
    expect(formatVnNumber(999)).toBe('999');
    expect(formatVnNumber(-0)).toBe('0');
    expect(formatVnNumber(null)).toBe('0');
    expect(formatVnNumber(Number.NaN)).toBe('0');
  });
  it('formatMultiplier dùng dấu phẩy, bỏ ",0", thiếu thì "1"', () => {
    expect(formatMultiplier(1.2)).toBe('1,2');
    expect(formatMultiplier(2)).toBe('2');
    expect(formatMultiplier(1.25)).toBe('1,25');
    expect(formatMultiplier(0)).toBe('1');
    expect(formatMultiplier(undefined)).toBe('1');
  });
  it('multiplierLabel có dấu nhân', () => {
    expect(multiplierLabel(1.2)).toBe('×1,2');
    expect(multiplierLabel(1)).toBe('×1');
  });
  it('tierPerkLabel đổi "x1.2" thành "×1,2" và giữ phần chữ khác', () => {
    expect(tierPerkLabel('Tích Điểm Xanh x1.2')).toBe('Tích Điểm Xanh ×1,2');
    expect(tierPerkLabel('Tích Điểm Xanh x1')).toBe('Tích Điểm Xanh ×1');
    expect(tierPerkLabel('Tích Điểm Xanh ×1,5')).toBe('Tích Điểm Xanh ×1,5');
    expect(tierPerkLabel('Freeship + giảm 5% mọi đơn')).toBe('Freeship + giảm 5% mọi đơn');
    expect(tierPerkLabel('Giao xe hơi')).toBe('Giao xe hơi');
    expect(tierPerkLabel('Tặng x1.000 điểm')).toBe('Tặng x1.000 điểm');
    expect(tierPerkLabel('Tích Điểm Xanh x1.5, freeship')).toBe('Tích Điểm Xanh ×1,5, freeship');
    expect(tierPerkLabel('Điểm thưởng x2.')).toBe('Điểm thưởng ×2.');
    expect(tierPerkLabel('Điểm thưởng (x1.2)')).toBe('Điểm thưởng (×1,2)');
    expect(tierPerkLabel('Tích điểm 1.2x')).toBe('Tích điểm ×1,2');
    expect(tierPerkLabel('Tích điểm 2x;')).toBe('Tích điểm ×2;');
    expect(tierPerkLabel('Tích Điểm Xanh x1.25')).toBe('Tích Điểm Xanh ×1,25');
    expect(tierPerkLabel('Cây xanh, Xuất xứ rõ ràng')).toBe('Cây xanh, Xuất xứ rõ ràng');
    expect(tierPerkLabel('Freeship đơn ≥ 99k')).toBe('Freeship đơn ≥ 99k');
    expect(tierPerkLabel('Mã giảm giá sinh nhật 50k')).toBe('Mã giảm giá sinh nhật 50k');
  });
});
