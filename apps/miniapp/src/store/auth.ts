import { create } from 'zustand';
import { setStorage, getStorage, removeStorage } from 'zmp-sdk/apis';
import type { AuthUser } from '@tubutree/shared-types';
import { loginZaloMiniApp, refreshTokens, setAccessToken, setUnauthorizedHandler } from '../services/api';
import { getZaloAccessToken, requestZaloPhoneToken } from '../services/zmp-bridge';

const REFRESH_KEY = 'tubu_refresh_token';

interface AuthState {
  user: AuthUser | null;
  status: 'idle' | 'loading' | 'authenticated' | 'error';
  error?: string;
  /** Đăng nhập ngầm (không xin SĐT) — dùng khi mở app. */
  login: () => Promise<void>;
  restore: () => Promise<void>;
  /** Xin + đính SĐT vào tài khoản (gọi đúng lúc cần: checkout). Trả phone hoặc null. */
  ensurePhone: () => Promise<string | null>;
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

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  // 'loading' ngay từ đầu: app luôn restore() khi mở → tránh nháy màn đăng nhập trước khi restore xong.
  status: 'loading',

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

  // Mở app: ưu tiên refresh token đã lưu; nếu chưa có → silent Zalo login (không xin SĐT).
  restore: async () => {
    set({ status: 'loading' });
    const refreshToken = await readRefresh();
    if (refreshToken) {
      try {
        const res = await refreshTokens(refreshToken);
        setAccessToken(res.accessToken);
        await persistRefresh(res.refreshToken);
        set({ user: res.user, status: 'authenticated' });
        return;
      } catch {
        await clearRefresh();
      }
    }
    // Chưa có phiên hợp lệ → đăng nhập ngầm bằng Zalo (im lặng, không sheet SĐT).
    try {
      const { code, accessToken } = await getZaloAccessToken();
      const res = await loginZaloMiniApp(code, accessToken);
      setAccessToken(res.accessToken);
      await persistRefresh(res.refreshToken);
      set({ user: res.user, status: 'authenticated' });
    } catch {
      // Không chặn app — vẫn cho duyệt trang chủ; hành động cần auth sẽ thử lại sau.
      set({ status: 'idle' });
    }
  },

  // Xin SĐT (sheet native) rồi đính vào tài khoản qua login lại kèm phoneToken.
  ensurePhone: async (): Promise<string | null> => {
    const current = get().user;
    if (current?.phone) return current.phone;
    const phoneToken = await requestZaloPhoneToken();
    if (!phoneToken) return null;
    try {
      const { code, accessToken } = await getZaloAccessToken();
      const res = await loginZaloMiniApp(code, accessToken, phoneToken);
      setAccessToken(res.accessToken);
      await persistRefresh(res.refreshToken);
      set({ user: res.user, status: 'authenticated' });
      return res.user.phone ?? null;
    } catch {
      return null;
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
