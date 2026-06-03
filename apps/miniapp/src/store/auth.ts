import { create } from 'zustand';
import { setStorage, getStorage, removeStorage } from 'zmp-sdk/apis';
import type { AuthUser } from '@tubutree/shared-types';
import { loginZaloMiniApp, refreshTokens, setAccessToken, setUnauthorizedHandler } from '../services/api';
import { getZaloAccessToken } from '../services/zmp-bridge';

const REFRESH_KEY = 'tubu_refresh_token';

interface AuthState {
  user: AuthUser | null;
  status: 'idle' | 'loading' | 'authenticated' | 'error';
  error?: string;
  login: () => Promise<void>;
  restore: () => Promise<void>;
  logout: () => Promise<void>;
}

async function persistRefresh(token: string): Promise<void> {
  await setStorage({ data: { [REFRESH_KEY]: token } });
}
async function readRefresh(): Promise<string | null> {
  const res = await getStorage({ keys: [REFRESH_KEY] });
  const val = (res as Record<string, unknown>)[REFRESH_KEY];
  return typeof val === 'string' && val.length > 0 ? val : null;
}
async function clearRefresh(): Promise<void> {
  await removeStorage({ keys: [REFRESH_KEY] });
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'idle',

  login: async () => {
    set({ status: 'loading', error: undefined });
    try {
      const { code, accessToken } = await getZaloAccessToken();
      const res = await loginZaloMiniApp(code, accessToken);
      setAccessToken(res.accessToken);
      await persistRefresh(res.refreshToken);
      set({ user: res.user, status: 'authenticated' });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : 'Đăng nhập thất bại' });
    }
  },

  restore: async () => {
    const refreshToken = await readRefresh();
    if (!refreshToken) {
      set({ status: 'idle' });
      return;
    }
    set({ status: 'loading' });
    try {
      const res = await refreshTokens(refreshToken);
      setAccessToken(res.accessToken);
      await persistRefresh(res.refreshToken);
      set({ user: res.user, status: 'authenticated' });
    } catch {
      await clearRefresh();
      set({ status: 'idle' });
    }
  },

  logout: async () => {
    setAccessToken(null);
    await clearRefresh();
    set({ user: null, status: 'idle' });
  },
}));

// Khi API gặp 401 → tự refresh bằng token đã lưu, trả access token mới cho interceptor.
setUnauthorizedHandler(async () => {
  const refreshToken = await readRefresh();
  if (!refreshToken) return null;
  try {
    const res = await refreshTokens(refreshToken);
    setAccessToken(res.accessToken);
    await persistRefresh(res.refreshToken);
    useAuthStore.setState({ user: res.user, status: 'authenticated' });
    return res.accessToken;
  } catch {
    await clearRefresh();
    useAuthStore.setState({ user: null, status: 'idle' });
    return null;
  }
});
