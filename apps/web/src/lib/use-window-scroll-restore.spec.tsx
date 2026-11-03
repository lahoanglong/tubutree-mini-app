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

  it('tài liệu mới nạp bằng Back/Forward (không có popstate): khôi phục một lần, thử lại tới khi đủ cao', async () => {
    vi.setSystemTime(Date.now() + 10_000);
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'back_forward', name: `${location.origin}/` } as PerformanceNavigationTiming]);
    vi.resetModules();
    const { useWindowScrollRestore: fresh } = await import('./use-window-scroll-restore');
    sessionStorage.setItem('tubu_scroll_web:home', '8400');
    maxY = 3000;
    const first = renderHook(() => fresh('home'));
    expect(y).toBe(3000);
    for (let i = 0; i < 8; i++) {
      maxY += 1000;
      act(() => {
        vi.advanceTimersByTime(300);
      });
    }
    expect(y).toBe(8400);
    first.unmount();
    y = 0;
    renderHook(() => fresh('home'));
    expect(y).toBe(0);
  });

  it('tài liệu nạp lại thường (không phải Back/Forward): bắt đầu từ đầu trang', async () => {
    vi.setSystemTime(Date.now() + 10_000);
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'navigate' } as PerformanceNavigationTiming]);
    vi.resetModules();
    const { useWindowScrollRestore: fresh } = await import('./use-window-scroll-restore');
    sessionStorage.setItem('tubu_scroll_web:home', '8400');
    renderHook(() => fresh('home'));
    expect(y).toBe(0);
  });

  it('tài liệu nạp bằng Back vào trang khác (nav.name khác pathname): không khôi phục', async () => {
    vi.setSystemTime(Date.now() + 10_000);
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'back_forward', name: `${location.origin}/dang-nhap` } as PerformanceNavigationTiming]);
    vi.resetModules();
    const { useWindowScrollRestore: fresh } = await import('./use-window-scroll-restore');
    sessionStorage.setItem('tubu_scroll_web:home', '8400');
    renderHook(() => fresh('home'));
    expect(y).toBe(0);
  });

  it('hết giờ mà chưa tới đích rồi rời trang: ghi vị trí đang đứng, không giữ giá trị cũ', () => {
    sessionStorage.setItem('tubu_scroll_web:home', '8400');
    maxY = 3000;
    back();
    const { unmount } = renderHook(() => useWindowScrollRestore('home'));
    maxY = 7000;
    act(() => {
      vi.advanceTimersByTime(4200);
    });
    expect(y).toBe(7000);
    unmount();
    expect(sessionStorage.getItem('tubu_scroll_web:home')).toBe('7000');
  });

  it('pointerdown (kéo thanh cuộn, bấm chip) thì thôi thử lại', () => {
    sessionStorage.setItem('tubu_scroll_web:home', '4529');
    maxY = 2200;
    back();
    renderHook(() => useWindowScrollRestore('home'));
    maxY = 6000;
    window.dispatchEvent(new Event('pointerdown'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(y).toBe(2200);
  });

  it('bấm link rồi trang co lại và cuộn về đầu trước khi gỡ hook: lưu vị trí lúc bấm', () => {
    vi.setSystemTime(Date.now() + 10_000);
    const { unmount } = renderHook(() => useWindowScrollRestore('home'));
    y = 6000;
    window.dispatchEvent(new Event('scroll'));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    y = 5900;
    window.dispatchEvent(new Event('scroll'));
    y = 0;
    window.dispatchEvent(new Event('scroll'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    unmount();
    expect(sessionStorage.getItem('tubu_scroll_web:home')).toBe('6000');
  });

  it('bấm nhưng ở lại trang (chip): hết nhịp giữ thì lưu vị trí hiện tại', () => {
    vi.setSystemTime(Date.now() + 10_000);
    const { unmount } = renderHook(() => useWindowScrollRestore('home'));
    y = 6000;
    window.dispatchEvent(new Event('scroll'));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    y = 2500;
    window.dispatchEvent(new Event('scroll'));
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(sessionStorage.getItem('tubu_scroll_web:home')).toBe('2500');
    unmount();
    expect(sessionStorage.getItem('tubu_scroll_web:home')).toBe('2500');
  });

  it('tới đích rồi trình duyệt tự khôi phục vị trí cũ kéo ngược: kéo lại về đích', () => {
    sessionStorage.setItem('tubu_scroll_web:home', '6091');
    maxY = 7000;
    back();
    renderHook(() => useWindowScrollRestore('home'));
    expect(y).toBe(6091);
    y = 5938;
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(y).toBe(6091);
  });
});
