// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./client-api', async (orig) => ({
  ...(await orig<typeof import('./client-api')>()),
  restoreSession: vi.fn().mockResolvedValue({ kind: 'none' }),
  apiFetch: (...a: unknown[]) => mocks.apiFetch(...a),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Auth = ReturnType<typeof import('./auth-context')['useAuth']>;

const USER = { id: 'u1', fullName: null, avatarUrl: null, role: 'CUSTOMER', pointsBalance: 0, walletBalance: 0, referralCode: 'R1' };

async function mountAuth() {
  vi.resetModules();
  const { AuthProvider, useAuth } = await import('./auth-context');
  const ref: { current: Auth | null } = { current: null };
  function Grab() {
    ref.current = useAuth();
    return null;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Grab />
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  const cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { auth: () => ref.current!, cleanup };
}

describe('AuthProvider — đăng nhập Email và Google trên web', () => {
  let cleanup: (() => void) | null = null;
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mocks.apiFetch.mockReset();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('loginWithEmailOtp: POST /auth/email-otp/verify không kèm token, nhận phiên y như Zalo (đặt cờ phiên, đã đăng nhập)', async () => {
    mocks.apiFetch.mockResolvedValue({ accessToken: 'at', refreshToken: '', user: USER });
    const m = await mountAuth();
    cleanup = m.cleanup;
    await act(async () => {
      await m.auth().loginWithEmailOtp('khach@gmail.com', '123456');
    });
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/email-otp/verify', {
      method: 'POST',
      body: { email: 'khach@gmail.com', code: '123456', firstTouch: undefined },
      auth: false,
    });
    expect(m.auth().status).toBe('authenticated');
    expect(m.auth().user?.id).toBe('u1');
    expect(localStorage.getItem('tubu_web_session')).not.toBeNull();
  });

  it('loginWithEmailOtp lỗi: ném lại cho form, trạng thái về idle (không kẹt loading)', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('Mã chưa đúng.'));
    const m = await mountAuth();
    cleanup = m.cleanup;
    await act(async () => {
      await expect(m.auth().loginWithEmailOtp('a@x.com', '000000')).rejects.toThrow('Mã chưa đúng.');
    });
    expect(m.auth().status).toBe('idle');
    expect(m.auth().user).toBeNull();
  });

  it('completeGoogleLogin: POST /auth/google/callback với code + state', async () => {
    mocks.apiFetch.mockResolvedValue({ accessToken: 'at', refreshToken: '', user: USER });
    const m = await mountAuth();
    cleanup = m.cleanup;
    await act(async () => {
      await m.auth().completeGoogleLogin('gcode', 'gstate');
    });
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/google/callback', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ code: 'gcode', state: 'gstate' }), auth: false }));
    expect(m.auth().status).toBe('authenticated');
  });

  it('startGoogleLogin: mở thẳng /auth/google/start của API với redirect_uri là trang /dang-nhap/google của chính web', async () => {
    const m = await mountAuth();
    const { apiPageUrl } = await import('./client-api');
    cleanup = m.cleanup;
    let href = '';
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://tubutree.com',
        set href(v: string) {
          href = v;
        },
      },
    });
    try {
      m.auth().startGoogleLogin();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
    const url = new URL(href);
    expect(`${url.origin}${url.pathname}`).toBe(apiPageUrl('/auth/google/start'));
    expect(url.searchParams.get('redirect_uri')).toBe('https://tubutree.com/dang-nhap/google');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
});
