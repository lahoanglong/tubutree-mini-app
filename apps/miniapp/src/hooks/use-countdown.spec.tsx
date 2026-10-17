import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCountdown, useCountdown } from './use-countdown';

describe('formatCountdown', () => {
  it('"Xh YYm", làm tròn LÊN theo phút để phút cuối không hiện "0h 00m" khi còn giờ', () => {
    expect(formatCountdown(3_600_000)).toBe('1h 00m');
    expect(formatCountdown(3_600_000 + 1)).toBe('1h 01m');
    expect(formatCountdown(90 * 60_000)).toBe('1h 30m');
    expect(formatCountdown(59_000)).toBe('0h 01m');
    expect(formatCountdown(1)).toBe('0h 01m');
  });
  it('hết giờ (<= 0) thì rỗng, không có "0h 00m"', () => {
    expect(formatCountdown(0)).toBe('');
    expect(formatCountdown(-5_000)).toBe('');
  });
});

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
    expect(result.current).toBe('0h 45m');
    act(() => {
      vi.advanceTimersByTime(30 * 60_000);
    });
    expect(result.current).toBe('0h 15m');
    act(() => {
      vi.advanceTimersByTime(15 * 60_000);
    });
    expect(result.current).toBe('');
  });
  it('mốc đã qua ngay từ đầu → rỗng', () => {
    expect(renderHook(() => useCountdown('2026-10-18T09:00:00.000Z')).result.current).toBe('');
  });
});
