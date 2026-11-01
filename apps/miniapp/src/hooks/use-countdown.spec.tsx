import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountdown } from './use-countdown';

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('target null hoặc không parse được → rỗng', () => {
    expect(renderHook(() => useCountdown(null)).result.current).toBe('');
    expect(renderHook(() => useCountdown('không phải ngày')).result.current).toBe('');
  });
  it('đếm tới mốc rồi về rỗng khi quá mốc', () => {
    const { result } = renderHook(() => useCountdown('2026-10-18T10:45:00.000Z'));
    expect(result.current).toBe('45 phút');
    act(() => {
      vi.advanceTimersByTime(30 * 60_000);
    });
    expect(result.current).toBe('15 phút');
    act(() => {
      vi.advanceTimersByTime(15 * 60_000);
    });
    expect(result.current).toBe('');
  });
  it('còn 2 giờ 05 phút ghi "2 giờ 05 phút" (luật chữ, không "2h 05m"); dưới 1 phút ghi "dưới 1 phút"', () => {
    expect(renderHook(() => useCountdown('2026-10-18T12:05:00.000Z')).result.current).toBe('2 giờ 05 phút');
    expect(renderHook(() => useCountdown('2026-10-18T10:00:59.000Z')).result.current).toBe('dưới 1 phút');
  });
  it('mốc đã qua ngay từ đầu → rỗng', () => {
    expect(renderHook(() => useCountdown('2026-10-18T09:00:00.000Z')).result.current).toBe('');
  });
});
