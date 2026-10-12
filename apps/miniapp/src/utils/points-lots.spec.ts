import { describe, it, expect } from 'vitest';
import { convertedPointsNote, pointsSummary } from './points-lots';

describe('pointsSummary / convertedPointsNote (PD-3: hai lô Điểm Xanh, khách chỉ thấy một số)', () => {
  it('tổng = lô thường + lô quy đổi; tách riêng phần không hết hạn', () => {
    expect(pointsSummary({ pointsBalance: 120, pointsConvertedBalance: 40 })).toEqual({ standard: 120, converted: 40, total: 160 });
  });

  it('API chưa trả lô quy đổi → coi như 0 (không NaN)', () => {
    expect(pointsSummary({ pointsBalance: 120 })).toEqual({ standard: 120, converted: 0, total: 120 });
  });

  it('số âm/rác bị kẹp 0', () => {
    expect(pointsSummary({ pointsBalance: -5, pointsConvertedBalance: -1 })).toEqual({ standard: 0, converted: 0, total: 0 });
  });

  it('ghi chú phần không hết hạn có dấu nghìn; không có điểm quy đổi thì không hiện gì', () => {
    expect(convertedPointsNote(1_250)).toBe('trong đó 1.250 điểm không hết hạn');
    expect(convertedPointsNote(0)).toBeNull();
    expect(convertedPointsNote(undefined)).toBeNull();
  });
});
