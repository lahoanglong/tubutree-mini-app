import { describe, expect, it } from 'vitest';
import { flashSaleState } from './admin-flash-sale';

const NOW = Date.parse('2026-11-03T05:00:00Z');
const sale = (startH: number, endH: number, isActive = true) => ({
  startAt: new Date(NOW + startH * 3600e3).toISOString(),
  endAt: new Date(NOW + endH * 3600e3).toISOString(),
  isActive,
});

describe('flashSaleState', () => {
  it('theo thời gian, đợt qua giờ kết thúc luôn là đã kết thúc dù cờ còn bật', () => {
    expect(flashSaleState(sale(-1, 1), NOW)).toBe('live');
    expect(flashSaleState(sale(1, 3), NOW)).toBe('scheduled');
    expect(flashSaleState(sale(-5, -1), NOW)).toBe('ended');
    expect(flashSaleState(sale(-5, -1, false), NOW)).toBe('ended');
    expect(flashSaleState(sale(-1, 1, false), NOW)).toBe('off');
  });
});
