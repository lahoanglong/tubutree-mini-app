import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRemaining, useRemaining } from './use-remaining';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('formatRemaining — thời gian còn lại đọc được bằng tiếng Việt', () => {
  it.each([
    [2 * HOUR + 15 * MIN, 'Còn 2 giờ 15 phút'],
    [3 * HOUR, 'Còn 3 giờ'],
    [45 * MIN, 'Còn 45 phút'],
    [MIN, 'Còn 1 phút'],
    [59_000, 'Còn dưới 1 phút'],
    [1, 'Còn dưới 1 phút'],
    [26 * HOUR + 10 * MIN, 'Còn 1 ngày 2 giờ'],
    [48 * HOUR, 'Còn 2 ngày'],
  ])('%i ms → "%s"', (ms, text) => {
    expect(formatRemaining(ms)).toBe(text);
  });

  it('hết hạn (0, âm) → "Đã quá hạn"', () => {
    expect(formatRemaining(0)).toBe('Đã quá hạn');
    expect(formatRemaining(-5_000)).toBe('Đã quá hạn');
  });
});

describe('useRemaining', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-17T10:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('không có hạn hoặc hạn không đọc được → text rỗng, chưa coi là quá hạn', () => {
    expect(renderHook(() => useRemaining(null)).result.current).toEqual({ text: '', expired: false });
    expect(renderHook(() => useRemaining(undefined)).result.current).toEqual({ text: '', expired: false });
    expect(renderHook(() => useRemaining('không phải ngày')).result.current).toEqual({ text: '', expired: false });
  });

  it('còn hạn: trả chữ còn lại và tự giảm theo thời gian', () => {
    const { result } = renderHook(() => useRemaining('2026-10-17T12:30:00Z'));
    expect(result.current).toEqual({ text: 'Còn 2 giờ 30 phút', expired: false });
    act(() => {
      vi.advanceTimersByTime(31 * MIN);
    });
    expect(result.current.text).toBe('Còn 1 giờ 59 phút');
  });

  it('chạm hạn thì chuyển sang quá hạn mà không cần tải lại', () => {
    const { result } = renderHook(() => useRemaining('2026-10-17T10:01:00Z'));
    expect(result.current.expired).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2 * MIN);
    });
    expect(result.current).toEqual({ text: 'Đã quá hạn', expired: true });
  });

  it('đổi hạn thì tính lại ngay, không chờ nhịp kế tiếp', () => {
    const { result, rerender } = renderHook(({ t }) => useRemaining(t), { initialProps: { t: '2026-10-17T11:00:00Z' } });
    expect(result.current.text).toBe('Còn 1 giờ');
    rerender({ t: '2026-10-17T10:20:00Z' });
    expect(result.current.text).toBe('Còn 20 phút');
  });

  it('dọn bộ hẹn giờ khi rời màn hình', () => {
    const { unmount } = renderHook(() => useRemaining('2026-10-17T12:00:00Z'));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
