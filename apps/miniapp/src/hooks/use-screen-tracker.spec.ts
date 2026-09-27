// @vitest-environment jsdom
// File giữ đuôi .ts (không phải .tsx) theo brief — dùng React.createElement thay vì cú pháp JSX
// để tránh esbuild parse .ts bằng loader 'ts' (không hỗ trợ JSX, chỉ .tsx mới có loader 'tsx').
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { useScreenTracker } from './use-screen-tracker';

vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
import { trackEvent } from '../services/analytics';

function wrapper({ children }: { children: ReactNode }) {
  return createElement(MemoryRouter, { initialEntries: ['/home'] }, children);
}

describe('useScreenTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });


  it('phát screen_viewed với route hiện tại khi mount', () => {
    renderHook(() => useScreenTracker(), { wrapper });

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith(
      'screen_viewed',
      'miniapp',
      expect.objectContaining({ route: '/home', prevRoute: null }),
    );
  });

  it('phát lại screen_viewed ở MỖI lần đổi route, kèm prevRoute là route trước đó', () => {
    // Hook kết hợp useNavigate() + useScreenTracker() để mô phỏng điều hướng thật (không chỉ
    // re-render) — đây là cách duy nhất chứng minh effect chạy lại theo location.pathname
    // thay vì chỉ chạy 1 lần lúc mount.
    const { result } = renderHook(
      () => {
        const navigate = useNavigate();
        useScreenTracker();
        return navigate;
      },
      { wrapper },
    );

    expect(trackEvent).toHaveBeenCalledTimes(1);

    act(() => {
      result.current('/cart');
    });
    expect(trackEvent).toHaveBeenCalledTimes(2);
    expect(trackEvent).toHaveBeenNthCalledWith(
      2,
      'screen_viewed',
      'miniapp',
      expect.objectContaining({ route: '/cart', prevRoute: '/home' }),
    );

    act(() => {
      result.current('/checkout');
    });
    expect(trackEvent).toHaveBeenCalledTimes(3);
    expect(trackEvent).toHaveBeenNthCalledWith(
      3,
      'screen_viewed',
      'miniapp',
      expect.objectContaining({ route: '/checkout', prevRoute: '/cart' }),
    );
  });
});
