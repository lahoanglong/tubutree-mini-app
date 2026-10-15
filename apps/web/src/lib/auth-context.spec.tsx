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
import { useAuthPhase } from './auth-phase';
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

  it('đăng xuất xoá thông tin hoá đơn VAT đã lưu (máy dùng chung không lộ MST/công ty/email cho người sau)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
    setSessionMarker();
    mocks.restoreSession.mockResolvedValue({ kind: 'ok', data: { accessToken: 'at', user: USER } });
    localStorage.setItem('tubu_invoice', '{"taxCode":"0100000001"}');
    localStorage.setItem('tubu_invoice:u1', '{"taxCode":"0312345678"}');
    localStorage.setItem('tubu_other', 'giữ');
    function LogoutProbe() {
      const { logout } = useAuth();
      return (
        <button id="logout" type="button" onClick={() => void logout()}>
          out
        </button>
      );
    }
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <Probe />
            <LogoutProbe />
          </AuthProvider>
        </QueryClientProvider>,
      );
    });
    expect(text()).toBe('init|authenticated|u1');
    await act(async () => {
      host.querySelector<HTMLButtonElement>('#logout')!.click();
    });
    expect(text()).toBe('init|idle|-');
    expect(localStorage.getItem('tubu_invoice')).toBeNull();
    expect(localStorage.getItem('tubu_invoice:u1')).toBeNull();
    expect(localStorage.getItem('tubu_other')).toBe('giữ');
    vi.unstubAllGlobals();
  });
});

describe('AuthProvider — mất kết nối lúc mở trang (R2-BUYERWEB-5)', () => {
  let root: Root;
  let host: HTMLDivElement;

  function PhaseProbe() {
    const phase = useAuthPhase();
    const { retrySession } = useAuth();
    return (
      <div>
        <p id="phase">{phase}</p>
        <button id="retry" type="button" onClick={() => void retrySession()}>
          retry
        </button>
      </div>
    );
  }
  const phase = () => host.querySelector('#phase')?.textContent;

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
            <PhaseProbe />
          </AuthProvider>
        </QueryClientProvider>,
      );
    });
  }

  it('cờ phiên còn mà API không trả lời → phase "unavailable", không phải "guest"', async () => {
    setSessionMarker();
    mocks.restoreSession.mockResolvedValue({ kind: 'transient' });
    await mount();
    expect(phase()).toBe('unavailable');
    expect(hasSessionMarker()).toBe(true);
  });

  it('bấm Thử lại khi API đã sống lại → vào được phiên', async () => {
    setSessionMarker();
    mocks.restoreSession
      .mockResolvedValueOnce({ kind: 'transient' })
      .mockResolvedValueOnce({ kind: 'ok', data: { accessToken: 'at', user: USER } });
    await mount();
    expect(phase()).toBe('unavailable');
    await act(async () => {
      host.querySelector<HTMLButtonElement>('#retry')!.click();
    });
    expect(phase()).toBe('authenticated');
  });

  it('phiên chết thật (401) → "guest" ngay, không giả vờ mất mạng', async () => {
    setSessionMarker();
    mocks.restoreSession.mockImplementationOnce(async () => {
      localStorage.clear();
      return { kind: 'dead' };
    });
    await mount();
    expect(phase()).toBe('guest');
  });

  it('khách chưa từng đăng nhập → "guest"', async () => {
    await mount();
    expect(phase()).toBe('guest');
  });
});
