// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/test-utils/render-hook';
import { useWindowScrollRestore } from './use-window-scroll-restore';

let y = 0;
let maxY = 6000;
beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  y = 0;
  maxY = 6000;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  window.scrollTo = ((_x: number, to: number) => {
    y = Math.min(to, maxY);
  }) as typeof window.scrollTo;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const back = () => window.dispatchEvent(new PopStateEvent('popstate'));

describe('useWindowScrollRestore', () => {
  it('Back (popstate) rồi mount: khôi phục vị trí đã lưu, thử lại khi trang còn ngắn', () => {
    sessionStorage.setItem('tubu_scroll_web:home', '4529');
    maxY = 2200;
    back();
    renderHook(() => useWindowScrollRestore('home'));
    expect(y).toBe(2200);
    maxY = 6000;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(y).toBe(4529);
  });

  it('mở mới bằng link (không có popstate gần đây): bắt đầu từ đầu trang dù còn vị trí cũ', () => {
    sessionStorage.setItem('tubu_scroll_web:home', '4529');
    vi.setSystemTime(Date.now() + 10_000);
    renderHook(() => useWindowScrollRestore('home'));
    expect(y).toBe(0);
  });

  it('cuộn thì lưu (debounce) và lưu lại khi rời trang', () => {
    vi.setSystemTime(Date.now() + 10_000);
    const { unmount } = renderHook(() => useWindowScrollRestore('home'));
    y = 1200;
    window.dispatchEvent(new Event('scroll'));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(sessionStorage.getItem('tubu_scroll_web:home')).toBe('1200');
    y = 1300;
    window.dispatchEvent(new Event('scroll'));
    unmount();
    expect(sessionStorage.getItem('tubu_scroll_web:home')).toBe('1300');
  });

  it('khách chạm trang thì thôi thử lại', () => {
    sessionStorage.setItem('tubu_scroll_web:home', '4529');
    maxY = 2200;
    back();
    renderHook(() => useWindowScrollRestore('home'));
    maxY = 6000;
    window.dispatchEvent(new Event('touchstart'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(y).toBe(2200);
  });

  it('rời trang giữa lúc đang khôi phục (bị kẹp) không ghi đè vị trí đã lưu', () => {
    sessionStorage.setItem('tubu_scroll_web:home', '4529');
    maxY = 2200;
    back();
    const { unmount } = renderHook(() => useWindowScrollRestore('home'));
    window.dispatchEvent(new Event('scroll'));
    unmount();
    expect(sessionStorage.getItem('tubu_scroll_web:home')).toBe('4529');
  });
});
