import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFlashExpiry, useFlashListExpiry } from './use-flash-expiry';

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

describe('useFlashListExpiry', () => {
  const at = (ms: number) => ({ endAt: new Date(NOW + ms).toISOString() });

  it('vẽ lại ở mốc sớm nhất, rồi ở mốc kế khi suất đó hết', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      useFlashListExpiry([at(20_000), at(5_000), at(60_000)]);
    });
    act(() => void vi.advanceTimersByTime(6_000));
    expect(renders).toBe(2);
    act(() => void vi.advanceTimersByTime(15_000));
    expect(renders).toBe(3);
    act(() => void vi.advanceTimersByTime(40_000));
    expect(renders).toBe(4);
    act(() => void vi.advanceTimersByTime(120_000));
    expect(renders).toBe(4);
  });

  it('bỏ qua suất đã quá hạn, không hạn hoặc hạn không đọc được: không hẹn gì khi không còn mốc phía trước', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      useFlashListExpiry([at(-1_000), {}, { endAt: 'khong-phai-ngay' }]);
    });
    act(() => void vi.advanceTimersByTime(120_000));
    expect(renders).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('suất đã quá hạn đứng đầu danh sách không che mốc của suất còn chạy', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      useFlashListExpiry([at(-5_000), at(5_000)]);
    });
    act(() => void vi.advanceTimersByTime(6_000));
    expect(renders).toBe(2);
  });
});
