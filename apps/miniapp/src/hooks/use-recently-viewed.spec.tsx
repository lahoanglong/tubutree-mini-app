import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RECENTLY_VIEWED_EVENT, RECENTLY_VIEWED_KEY, clearRecentlyViewed, recordRecentlyViewed,
} from '../utils/recently-viewed';
import { useRecentlyViewed } from './use-recently-viewed';

describe('useRecentlyViewed', () => {
  beforeEach(() => localStorage.clear());

  it('đọc từ localStorage và cập nhật ngay khi PDP ghi thêm (cùng tab)', () => {
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current).toEqual([]);
    act(() => {
      recordRecentlyViewed({ slug: 'a', name: 'SP A', thumbnail: null, price: 1000 });
    });
    expect(result.current.map((x) => x.slug)).toEqual(['a']);
  });

  it('giữ nguyên tham chiếu mảng khi dữ liệu không đổi (không render lặp)', () => {
    recordRecentlyViewed({ slug: 'a', name: 'SP A', thumbnail: null, price: 1000 });
    const { result, rerender } = renderHook(() => useRecentlyViewed());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('dữ liệu hỏng → []', () => {
    localStorage.setItem(RECENTLY_VIEWED_KEY, 'not json');
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current).toEqual([]);
  });

  it('cập nhật khi tab KHÁC ghi (sự kiện storage)', () => {
    const { result } = renderHook(() => useRecentlyViewed());
    act(() => {
      const raw = JSON.stringify([{ slug: 'z', name: 'SP Z', thumbnail: null, price: 5, viewedAt: 9 }]);
      localStorage.setItem(RECENTLY_VIEWED_KEY, raw);
      window.dispatchEvent(new StorageEvent('storage', { key: RECENTLY_VIEWED_KEY, newValue: raw }));
    });
    expect(result.current.map((x) => x.slug)).toEqual(['z']);
  });

  it('clearRecentlyViewed làm hook về [] ngay trong cùng tab', () => {
    recordRecentlyViewed({ slug: 'a', name: 'SP A', thumbnail: null, price: 1000 });
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current).toHaveLength(1);
    act(() => clearRecentlyViewed());
    expect(result.current).toEqual([]);
  });

  it('localStorage.getItem ném (WebView chặn) → [] và không ném khi render', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      const { result } = renderHook(() => useRecentlyViewed());
      expect(result.current).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('gỡ đúng các listener đã đăng ký khi unmount (không rò rỉ)', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const ours = ([t]: unknown[]) => t === RECENTLY_VIEWED_EVENT || t === 'storage';
    try {
      const { unmount } = renderHook(() => useRecentlyViewed());
      const added = add.mock.calls.filter(ours);
      expect(added.map(([t]) => t).sort()).toEqual([RECENTLY_VIEWED_EVENT, 'storage'].sort());
      unmount();
      expect(remove.mock.calls.filter(ours).map(([t]) => t).sort()).toEqual(added.map(([t]) => t).sort());
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });
});
