import { describe, expect, it } from 'vitest';
import { FLASH_WINDOW_ORDER_MESSAGE, flashSaleState, flashWindowOrderError } from './admin-flash-sale';

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

describe('flashWindowOrderError', () => {
  it('báo khi giờ kết thúc bằng hoặc trước giờ bắt đầu; chưa đủ hai mốc hoặc đúng thứ tự thì không báo', () => {
    expect(flashWindowOrderError('2026-11-10T09:00', '2026-11-10T09:00')).toBe(FLASH_WINDOW_ORDER_MESSAGE);
    expect(flashWindowOrderError('2026-11-10T09:00', '2026-11-09T23:45')).toBe(FLASH_WINDOW_ORDER_MESSAGE);
    expect(flashWindowOrderError('2026-11-10T09:00', '2026-11-10T09:15')).toBeNull();
    expect(flashWindowOrderError('', '2026-11-10T09:15')).toBeNull();
    expect(flashWindowOrderError('2026-11-10T09:00', '')).toBeNull();
  });
});
