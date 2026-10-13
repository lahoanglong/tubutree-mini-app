// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ restoreSession: vi.fn() }));
vi.mock('./client-api', async (orig) => ({
  ...(await orig<typeof import('./client-api')>()),
  restoreSession: mocks.restoreSession,
}));

import { AuthProvider, useAuth } from './auth-context';
import { setSessionMarker, hasSessionMarker } from './client-api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const { status, user, initialized } = useAuth();
  return <p id="probe">{`${initialized ? 'init' : 'boot'}|${status}|${user?.id ?? '-'}`}</p>;
}

const USER = { id: 'u1', fullName: 'An', avatarUrl: null, role: 'CUSTOMER', pointsBalance: 0, walletBalance: 0, referralCode: 'R' };

describe('AuthProvider — khôi phục phiên (BUYERWEB-2)', () => {
  let root: Root;
  let host: HTMLDivElement;
  const text = () => host.querySelector('#probe')?.textContent;

  beforeEach(() => {
    localStorage.clear();
    mocks.restoreSession.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function mount() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <Probe />
          </AuthProvider>
        </QueryClientProvider>,
      );
    });
  }

  it('lỗi tạm lúc mở trang → chưa vào được nhưng GIỮ cờ; có mạng lại thì tự khôi phục', async () => {
    setSessionMarker();
    mocks.restoreSession
      .mockResolvedValueOnce({ kind: 'transient' })
      .mockResolvedValueOnce({ kind: 'ok', data: { accessToken: 'at', user: USER } });
    await mount();
    expect(text()).toBe('init|idle|-');
    expect(hasSessionMarker()).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(text()).toBe('init|authenticated|u1');
    expect(mocks.restoreSession).toHaveBeenCalledTimes(2);
  });

  it('phiên chết (cờ đã bị xoá) → không thử lại khi có mạng', async () => {
    setSessionMarker();
    mocks.restoreSession.mockImplementationOnce(async () => {
      localStorage.clear();
      return { kind: 'dead' };
    });
    await mount();
    expect(text()).toBe('init|idle|-');
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(mocks.restoreSession).toHaveBeenCalledTimes(1);
  });

  it('khách chưa từng đăng nhập → không gọi refresh', async () => {
    await mount();
    expect(text()).toBe('init|idle|-');
    expect(mocks.restoreSession).not.toHaveBeenCalled();
  });
});
