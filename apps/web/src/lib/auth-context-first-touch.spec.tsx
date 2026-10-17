// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./client-api', async (orig) => ({
  ...(await orig<typeof import('./client-api')>()),
  apiFetch: mocks.apiFetch,
  restoreSession: vi.fn().mockResolvedValue({ kind: 'dead' }),
}));

import { AuthProvider, useAuth } from './auth-context';
import { FIRST_TOUCH_COOKIE } from './entry-source';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOGIN = { accessToken: 'at', refreshToken: '', user: { id: 'u1', fullName: 'An', avatarUrl: null, role: 'CUSTOMER', pointsBalance: 0, walletBalance: 0, referralCode: 'R' } };

describe('AuthProvider.handleCallback — nguồn chạm đầu đi kèm đăng nhập Zalo', () => {
  let handleCallback: (code: string, state: string | null) => Promise<void>;

  function Grab() {
    handleCallback = useAuth().handleCallback;
    return null;
  }

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('tubu_oauth_state', 's1');
    sessionStorage.setItem('tubu_pkce_verifier', 'ver');
    mocks.apiFetch.mockReset().mockResolvedValue(LOGIN);
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () =>
      createRoot(host).render(
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <Grab />
          </AuthProvider>
        </QueryClientProvider>,
      ),
    );
  });
  afterEach(() => {
    document.cookie = `${FIRST_TOUCH_COOKIE}=; path=/; max-age=0`;
  });

  const bodyOfLogin = () => (mocks.apiFetch.mock.calls.find((c) => c[0] === '/auth/zalo-oauth')![1] as { body: Record<string, unknown> }).body;

  it('có cookie chạm đầu → gửi firstTouch trong body', async () => {
    const ft = { source: 'shopee', campaign: 'card-2610', at: '2026-10-18T00:00:00.000Z' };
    document.cookie = `${FIRST_TOUCH_COOKIE}=${encodeURIComponent(JSON.stringify(ft))}; path=/`;
    await act(async () => handleCallback('code', 's1'));
    expect(bodyOfLogin()).toEqual({ code: 'code', codeVerifier: 'ver', firstTouch: ft });
  });

  it('không có cookie → body như cũ, đăng nhập vẫn chạy', async () => {
    await act(async () => handleCallback('code', 's1'));
    expect(bodyOfLogin()).toEqual({ code: 'code', codeVerifier: 'ver', firstTouch: undefined });
  });
});
