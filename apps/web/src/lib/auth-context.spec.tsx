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
import { loadDraft, markResume, peekResume, saveDraft, EMPTY_DRAFT } from './recycle-wizard';

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

  it('mất cờ phiên nhưng còn cookie phiên và gợi ý bố cục: mở trang xoá cả hai cookie, không gọi khôi phục', async () => {
    document.cookie = 'tubu_web_session=1; Path=/';
    document.cookie = 'tubu_home_hint=returning-1; Path=/';
    await mount();
    expect(text()).toBe('init|idle|-');
    expect(mocks.restoreSession).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain('tubu_web_session');
    expect(document.cookie).not.toContain('tubu_home_hint');
  });

  it('khôi phục ra tài khoản khác với gợi ý đã lưu: bỏ gợi ý của người trước, xoá cả cookie gợi ý', async () => {
    setSessionMarker();
    document.cookie = 'tubu_home_hint=returning-2; Path=/';
    localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'other', kind: 'returning' }));
    localStorage.setItem('tubu_home_todo_rows', JSON.stringify({ userId: 'other', rows: 2 }));
    mocks.restoreSession.mockResolvedValueOnce({ kind: 'ok', data: { accessToken: 'at', user: USER } });
    await mount();
    expect(text()).toBe('init|authenticated|u1');
    expect(localStorage.getItem('tubu_home_kind')).toBeNull();
    expect(localStorage.getItem('tubu_home_todo_rows')).toBeNull();
    expect(document.cookie).not.toContain('tubu_home_hint');
  });

  it('khôi phục đúng tài khoản đã lưu: giữ gợi ý và cookie', async () => {
    setSessionMarker();
    document.cookie = 'tubu_home_hint=returning-2; Path=/';
    localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'u1', kind: 'returning' }));
    mocks.restoreSession.mockResolvedValueOnce({ kind: 'ok', data: { accessToken: 'at', user: USER } });
    await mount();
    expect(localStorage.getItem('tubu_home_kind')).not.toBeNull();
    expect(document.cookie).toContain('tubu_home_hint=returning-2');
  });

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
    localStorage.setItem('tubu_ctv_recent_customers:u1', '[{"recipient":"An"}]');
    localStorage.setItem('tubu_other', 'giữ');
    saveDraft({ ...EMPTY_DRAFT, lines: { 'item-carton': 3 } });
    markResume();
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
    expect(localStorage.getItem('tubu_ctv_recent_customers:u1')).toBeNull();
    expect(localStorage.getItem('tubu_other')).toBe('giữ');
    expect(loadDraft()).toBeNull();
    expect(peekResume()).toBe(false);
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
