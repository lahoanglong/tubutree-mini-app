import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFlashExpiry } from './use-flash-expiry';

const NOW = Date.parse('2026-11-01T05:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('useFlashExpiry', () => {
  it('vẽ lại đúng một lần sau mốc kết thúc để thẻ bỏ giá Giờ vàng', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      useFlashExpiry(new Date(NOW + 5_000).toISOString());
    });
    expect(renders).toBe(1);
    act(() => void vi.advanceTimersByTime(4_000));
    expect(renders).toBe(1);
    act(() => void vi.advanceTimersByTime(2_000));
    expect(renders).toBe(2);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(renders).toBe(2);
  });

  it('không hẹn giờ khi không có hạn, hạn đã qua hoặc không đọc được', () => {
    for (const endAt of [undefined, new Date(NOW - 1).toISOString(), 'khong-phai-ngay']) {
      let renders = 0;
      const { unmount } = renderHook(() => {
        renders += 1;
        useFlashExpiry(endAt);
      });
      act(() => void vi.advanceTimersByTime(120_000));
      expect(renders).toBe(1);
      unmount();
    }
  });

  it('huỷ hẹn giờ khi thẻ bị gỡ', () => {
    const { unmount } = renderHook(() => useFlashExpiry(new Date(NOW + 5_000).toISOString()));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
