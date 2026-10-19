import { describe, expect, it } from 'vitest';
import { pointsEarnPreview, pointsForGoods } from './points-earn';

// Bản chép của apps/miniapp/src/utils/points-earn.spec.ts: cùng công thức server (pointsForGoods của API).
describe('pointsForGoods', () => {
  it('làm tròn xuống theo % tích và hệ số hạng', () => {
    expect(pointsForGoods(289000, 0.02, 1)).toBe(57);
    expect(pointsForGoods(289000, 0.02, 1.5)).toBe(86);
  });
  it('tham số xấu thì 0', () => {
    expect(pointsForGoods(0, 0.02)).toBe(0);
    expect(pointsForGoods(1000, 0)).toBe(0);
    expect(pointsForGoods(1000, 0.02, 0)).toBe(0);
  });
});

describe('pointsEarnPreview', () => {
  const rates = { earnPct: 0.02, vndPerPointRedeem: 100 };
  it('đủ tham số: nêu số điểm và giá trị quy đổi', () => {
    expect(pointsEarnPreview(289000, rates, 1)).toEqual({ points: 57, valueVnd: 5700 });
  });
  it('thiếu mốc hoặc chưa biết hệ số hạng: nói chung', () => {
    expect(pointsEarnPreview(289000, undefined, 1)).toBe('generic');
    expect(pointsEarnPreview(289000, rates, null)).toBe('generic');
  });
  it('không có hàng: không nói gì', () => {
    expect(pointsEarnPreview(0, rates, 1)).toBeNull();
  });
});
