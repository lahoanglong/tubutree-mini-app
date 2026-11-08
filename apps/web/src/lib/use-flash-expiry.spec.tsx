// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/test-utils/render-hook';
import { useFlashListExpiry } from './use-flash-expiry';

const NOW = Date.parse('2026-11-08T05:00:00Z');
const at = (ms: number) => ({ endAt: new Date(NOW + ms).toISOString() });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('useFlashListExpiry', () => {
  it('vẽ lại ở mốc kết thúc sớm nhất, rồi ở mốc kế khi suất đó hết', () => {
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

  it('suất đã quá hạn đứng trong danh sách không che mốc của suất còn chạy (kho chỉ làm mới sau 5 đến 60 giây)', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      useFlashListExpiry([at(-5_000), at(5_000)]);
    });
    act(() => void vi.advanceTimersByTime(6_000));
    expect(renders).toBe(2);
  });

  it('không hẹn gì khi không còn mốc phía trước (quá hạn, không hạn hoặc hạn không đọc được)', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      useFlashListExpiry([at(-1_000), {}, { endAt: 'khong-phai-ngay' }]);
    });
    act(() => void vi.advanceTimersByTime(120_000));
    expect(renders).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
