import { describe, expect, it } from 'vitest';
import { clampPercent, flashDisplay, soldPercent } from './flash-display';

describe('soldPercent / clampPercent', () => {
  it('bán quá suất, suất 0 hoặc số lạ không được in ra 150%, NaN%', () => {
    expect(soldPercent(15, 10)).toBe(100);
    expect(soldPercent(3, 0)).toBe(0);
    expect(soldPercent(1, 3)).toBe(33);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampPercent(-4)).toBe(0);
  });
});

describe('flashDisplay', () => {
  it('giá khách trả = min(giá flash, giá đang bán); % theo giá đang bán', () => {
    expect(flashDisplay({ flashPrice: 70_000, retailPrice: 100_000 })).toEqual({ price: 70_000, was: 100_000, pct: 30 });
    expect(flashDisplay({ flashPrice: 70_000, retailPrice: 100_000, salePrice: 80_000 })).toEqual({ price: 70_000, was: 80_000, pct: 13 });
  });

  it('giá niêm yết hạ sau khi tạo đợt: flash không còn rẻ hơn thì không hiện % âm hay giá gạch thấp hơn', () => {
    expect(flashDisplay({ flashPrice: 90_000, retailPrice: 100_000, salePrice: 60_000 })).toEqual({ price: 60_000, was: 60_000, pct: 0 });
  });
});
