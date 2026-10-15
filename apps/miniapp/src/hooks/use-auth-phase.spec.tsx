import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('zmp-sdk/apis', () => ({ setStorage: vi.fn(), getStorage: vi.fn(), removeStorage: vi.fn() }));

import { useAuthStore } from '../store/auth';
import { useAuthPhase, useSessionRecovery, SESSION_RETRY_DELAYS_MS } from './use-auth-phase';

function setStatus(status: 'idle' | 'loading' | 'authenticated' | 'error') {
  act(() => useAuthStore.setState({ status }));
}

describe('useAuthPhase', () => {
  it('đổi trạng thái phiên thành 4 pha: loading, guest, unavailable, authenticated', () => {
    const { result } = renderHook(() => useAuthPhase());
    setStatus('loading');
    expect(result.current).toBe('loading');
    setStatus('idle');
    expect(result.current).toBe('guest');
    setStatus('error');
    expect(result.current).toBe('unavailable');
    setStatus('authenticated');
    expect(result.current).toBe('authenticated');
  });
});

describe('useSessionRecovery', () => {
  const restore = vi.fn(() => Promise.resolve());
  let visibility: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    vi.useFakeTimers();
    restore.mockClear();
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    useAuthStore.setState({ status: 'error', restore });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('phiên ở trạng thái lỗi: có mạng lại (sự kiện online) thì khôi phục phiên ngay', () => {
    renderHook(() => useSessionRecovery());
    expect(restore).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('online'));
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('quay lại app (visibilitychange sang visible) thì khôi phục phiên; đang ẩn thì không', () => {
    renderHook(() => useSessionRecovery());
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(restore).not.toHaveBeenCalled();
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('không có sự kiện nào (webview làm rơi sự kiện online) vẫn tự thử lại theo nhịp tăng dần, không dồn dập', () => {
    renderHook(() => useSessionRecovery());
    vi.advanceTimersByTime(SESSION_RETRY_DELAYS_MS[0]! - 1);
    expect(restore).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(restore).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SESSION_RETRY_DELAYS_MS[1]!);
    expect(restore).toHaveBeenCalledTimes(2);
    expect(SESSION_RETRY_DELAYS_MS[1]!).toBeGreaterThan(SESSION_RETRY_DELAYS_MS[0]!);
  });

  it('app đang ẩn thì tạm dừng thử lại nền', () => {
    renderHook(() => useSessionRecovery());
    visibility = 'hidden';
    vi.advanceTimersByTime(SESSION_RETRY_DELAYS_MS[0]! * 3);
    expect(restore).not.toHaveBeenCalled();
  });

  it('phiên không ở trạng thái lỗi (đang tải, đã đăng nhập, khách) thì không khôi phục gì', () => {
    useAuthStore.setState({ status: 'authenticated' });
    renderHook(() => useSessionRecovery());
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(10 * 60_000);
    expect(restore).not.toHaveBeenCalled();
  });

  it('khôi phục xong (status đổi khỏi lỗi) thì dừng hẳn; unmount cũng gỡ listener và timer', () => {
    const { unmount } = renderHook(() => useSessionRecovery());
    act(() => useAuthStore.setState({ status: 'authenticated' }));
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(10 * 60_000);
    expect(restore).not.toHaveBeenCalled();

    act(() => useAuthStore.setState({ status: 'error' }));
    unmount();
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(10 * 60_000);
    expect(restore).not.toHaveBeenCalled();
  });
});
