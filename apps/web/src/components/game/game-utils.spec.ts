import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDrops, formatNumber, formatPoints } from './format';
import { categoryLabel, difficultyLabel, isSameVNDay } from './game-utils';

afterEach(() => vi.useRealTimers());

describe('formatNumber / formatDrops / formatPoints', () => {
  it('dấu chấm nghìn kiểu vi-VN, rác thành 0, không có -0', () => {
    expect(formatNumber(1250000)).toBe('1.250.000');
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber(Number.NaN)).toBe('0');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('0');
    expect(formatNumber(-0)).toBe('0');
  });

  it('giọt nước và điểm có đơn vị', () => {
    expect(formatDrops(1250)).toBe('1.250💧');
    expect(formatPoints(20000)).toBe('20.000 điểm');
  });
});

describe('isSameVNDay', () => {
  it('cùng ngày theo giờ VN, không theo UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T18:00:00Z')); // 01:00 ngày 20/10 giờ VN
    expect(isSameVNDay('2026-10-19T17:30:00Z')).toBe(true); // 00:30 ngày 20/10 giờ VN
    expect(isSameVNDay('2026-10-19T16:30:00Z')).toBe(false); // 23:30 ngày 19/10 giờ VN
    expect(isSameVNDay(null)).toBe(false);
  });
});

describe('nhãn quiz', () => {
  it('phân loại lạ rơi về Thiên nhiên; độ khó theo ngưỡng', () => {
    expect(categoryLabel('tai_che')).toBe('♻️ Tái chế');
    expect(categoryLabel('khac')).toBe('🌿 Thiên nhiên');
    expect([1, 2, 3, 4].map(difficultyLabel)).toEqual(['Dễ', 'Vừa', 'Khó', 'Khó']);
  });
});
