import { describe, expect, it } from 'vitest';
import { earnPctOf, percentLabel, pointsBoostOf } from './points-boost';

// Chép ý nghĩa loyalty-copy.spec của Mini App cho phần dải "tích nhiều hơn".
describe('earnPctOf', () => {
  it('ưu tiên earnPct; API cũ chỉ có vndPerPoint thì quy ngược; không có số dùng được → null', () => {
    expect(earnPctOf({ earnPct: 2, vndPerPoint: 100 })).toBe(2);
    expect(earnPctOf({ vndPerPoint: 50 })).toBe(2);
    expect(earnPctOf({ earnPct: 0 })).toBeNull();
    expect(earnPctOf({ earnPct: Number.NaN, vndPerPoint: -1 })).toBeNull();
    expect(earnPctOf({})).toBeNull();
  });
});

describe('percentLabel', () => {
  it('số thập phân kiểu Việt, bỏ ",0"', () => {
    expect(percentLabel(2)).toBe('2%');
    expect(percentLabel(2.4)).toBe('2,4%');
    expect(percentLabel(1.25)).toBe('1,3%');
  });
});

describe('pointsBoostOf', () => {
  it('không có config hoặc không có mức đơn app → null', () => {
    expect(pointsBoostOf(undefined)).toBeNull();
    expect(pointsBoostOf({})).toBeNull();
  });

  it('cờ đơn sàn tắt hoặc mức app không cao hơn → chỉ nói mức đơn app', () => {
    expect(pointsBoostOf({ earnPct: 2, marketplaceEarnPct: 1, marketplaceClaimEnabled: false })).toEqual({ kind: 'plain', appPct: 2 });
    expect(pointsBoostOf({ earnPct: 1, marketplaceEarnPct: 1, marketplaceClaimEnabled: true })).toEqual({ kind: 'plain', appPct: 1 });
    expect(pointsBoostOf({ earnPct: 2 })).toEqual({ kind: 'plain', appPct: 2 });
  });

  it('cờ bật và app cao hơn → so sánh; đúng gấp đôi thì double', () => {
    expect(pointsBoostOf({ earnPct: 2, marketplaceEarnPct: 1, marketplaceClaimEnabled: true })).toEqual({
      kind: 'compare', double: true, appPct: 2, marketplacePct: 1,
    });
    expect(pointsBoostOf({ earnPct: 3, marketplaceEarnPct: 2, marketplaceClaimEnabled: true })).toMatchObject({ kind: 'compare', double: false });
  });
});
