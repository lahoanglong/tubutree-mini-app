import { describe, expect, it } from 'vitest';
import { clampPercent, soldPercent } from './flash-display';

describe('soldPercent (Đã bán % của giờ vàng)', () => {
  it('làm tròn theo tỉ lệ đã bán / suất', () => {
    expect(soldPercent(2, 10)).toBe(20);
    expect(soldPercent(1, 3)).toBe(33);
  });
  it('bán quá suất thì kẹp 100, không in 150% hay 400%', () => {
    expect(soldPercent(15, 10)).toBe(100);
    expect(soldPercent(40, 10)).toBe(100);
  });
  it('suất bằng 0 hoặc số lạ thì 0, không NaN/Infinity/âm', () => {
    expect(soldPercent(5, 0)).toBe(0);
    expect(soldPercent(-3, 10)).toBe(0);
    expect(soldPercent(Number.NaN, 10)).toBe(0);
    expect(soldPercent(3, Number.NaN)).toBe(0);
  });
});

describe('clampPercent', () => {
  it('nguyên, trong 0–100', () => {
    expect(clampPercent(33.4)).toBe(33);
    expect(clampPercent(400)).toBe(100);
    expect(clampPercent(-2)).toBe(0);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
