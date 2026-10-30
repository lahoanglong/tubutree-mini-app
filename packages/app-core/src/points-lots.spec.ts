import { describe, expect, it } from 'vitest';
import { convertedPointsNote, lockedPointsLabel, pointsSummary } from './points-lots';

describe('pointsSummary / convertedPointsNote / lockedPointsLabel (R-163: một luật cho web và Mini)', () => {
  it('tổng = lô thường + lô quy đổi', () => {
    expect(pointsSummary({ pointsBalance: 120, pointsConvertedBalance: 40 })).toEqual({ standard: 120, converted: 40, total: 160 });
  });
  it('thiếu lô quy đổi → 0; số âm, NaN, vô cực → 0', () => {
    expect(pointsSummary({ pointsBalance: 120 })).toEqual({ standard: 120, converted: 0, total: 120 });
    expect(pointsSummary({ pointsBalance: -5, pointsConvertedBalance: -1 })).toEqual({ standard: 0, converted: 0, total: 0 });
    expect(pointsSummary({ pointsBalance: Number.NaN, pointsConvertedBalance: Number.POSITIVE_INFINITY })).toEqual({ standard: 0, converted: 0, total: 0 });
  });
  it('ghi chú phần không hết hạn có dấu nghìn; không có điểm quy đổi thì null', () => {
    expect(convertedPointsNote(1_250)).toBe('trong đó 1.250 điểm không hết hạn');
    expect(convertedPointsNote(0)).toBeNull();
    expect(convertedPointsNote(undefined)).toBeNull();
    expect(convertedPointsNote(null)).toBeNull();
  });
  it('nhãn ô khoá chỉ ghi tổng số dư', () => {
    expect(lockedPointsLabel(500)).toBe('Bạn đang có 500 điểm');
    expect(lockedPointsLabel(1800)).toBe('Bạn đang có 1.800 điểm');
    expect(lockedPointsLabel(0)).toBe('Bạn đang có 0 điểm');
  });
});
