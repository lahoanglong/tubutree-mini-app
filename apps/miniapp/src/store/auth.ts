import { create } from 'zustand';
import { setStorage, getStorage, removeStorage } from 'zmp-sdk/apis';
import type { AuthUser, LoginResponse } from '@tubutree/shared-types';
import {
  loginGuest,
  loginZaloMiniApp,
  refreshTokens,
  setAccessToken,
  setUnauthorizedHandler,
} from '../services/api';
import { getZaloAccessToken, requestZaloPhoneToken, getLaunchReferral } from '../services/zmp-bridge';

const REFRESH_KEY = 'tubu_refresh_token';
const DEVICE_KEY = 'tubu_device_id';

/** ID thiết bị ổn định cho đăng nhập khách (tạo 1 lần, lưu ZMP storage). */
async function getDeviceId(): Promise<string> {
  const res = await getStorage({ keys: [DEVICE_KEY] });
  const existing = (res as Record<string, unknown>)[DEVICE_KEY];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  const id = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  await setStorage({ data: { [DEVICE_KEY]: id } });
  return id;
}

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

/**
 * Refresh phiên — DÙNG CHUNG cho restore() và handler 401, dedup qua 1 promise.
 * BE xoay refresh token (single-use): nếu 2 nơi refresh CÙNG token song song,
 * 1 cái thắng, cái kia bị 401 "token đã dùng" → logout nhầm. Serialize để tránh.
 * Trả null nếu chưa có refresh token; throw nếu refresh thất bại.
 */
let refreshInFlight: Promise<LoginResponse | null> | null = null;
function refreshSession(): Promise<LoginResponse | null> {
  refreshInFlight ??= (async () => {
    const token = await readRefresh();
    if (!token) return null;
    return refreshTokens(token);
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  // 'loading' ngay từ đầu: app luôn restore() khi mở → tránh nháy màn đăng nhập trước khi restore xong.
  status: 'loading',

  login: async () => {
    set({ status: 'loading', error: undefined });
    const ref = getLaunchReferral();
    try {
      const { code, accessToken } = await getZaloAccessToken();
      const res = await loginZaloMiniApp(code, accessToken, undefined, ref);
      setAccessToken(res.accessToken);
      await persistRefresh(res.refreshToken);
      set({ user: res.user, status: 'authenticated' });
      return;
    } catch {
      /* Zalo chưa khả dụng → fallback guest bên dưới */
    }
    // Fallback khách (Zalo chưa khả dụng) — app vẫn dùng được đầy đủ.
    try {
      const res = await loginGuest(await getDeviceId(), ref);
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
    try {
      const res = await refreshSession();
      if (res) {
        setAccessToken(res.accessToken);
        await persistRefresh(res.refreshToken);
        set({ user: res.user, status: 'authenticated' });
        return;
      }
    } catch {
      await clearRefresh();
    }
    // Chưa có phiên hợp lệ → đăng nhập ngầm bằng Zalo (im lặng, không sheet SĐT).
    const ref = getLaunchReferral();
    try {
      const { code, accessToken } = await getZaloAccessToken();
      const res = await loginZaloMiniApp(code, accessToken, undefined, ref);
      setAccessToken(res.accessToken);
      await persistRefresh(res.refreshToken);
      set({ user: res.user, status: 'authenticated' });
      return;
    } catch {
      /* Zalo chưa khả dụng → fallback guest bên dưới */
    }
    // Zalo login chưa khả dụng (vd app chưa kích hoạt -1401) → đăng nhập KHÁCH theo
    // deviceId để app vẫn chạy đầy đủ (giỏ/vườn/tài khoản/mua hàng).
    try {
      const res = await loginGuest(await getDeviceId(), ref);
      setAccessToken(res.accessToken);
      await persistRefresh(res.refreshToken);
      set({ user: res.user, status: 'authenticated' });
    } catch (err) {
      // Guest fallback fail = lỗi mạng/server/CORS (không phải "chưa đăng nhập") → set 'error' +
      // message để UI báo đúng "chưa kết nối được, thử lại" thay vì 'idle' im lặng (mất ngữ cảnh).
      set({ status: 'error', error: err instanceof Error ? err.message : 'Chưa kết nối được máy chủ' });
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
    // Xoá sạch cache React Query (ví, lương, hoa hồng...) — không để lộ dữ liệu tài
    // chính của user vừa đăng xuất cho user kế tiếp trên cùng thiết bị dùng chung
    // (VD tablet chấm công cửa hàng). Đăng ký qua setLogoutCleanup() ở app.tsx để
    // tránh import vòng (store/auth.ts <-> components/app.tsx).
    onLogoutCleanup?.();
  },
}));

let onLogoutCleanup: (() => void) | null = null;
/** Đăng ký hàm dọn dẹp (vd queryClient.clear()) chạy sau khi logout thành công. */
export function setLogoutCleanup(fn: () => void): void {
  onLogoutCleanup = fn;
}

// Khi API gặp 401 → tự refresh bằng token đã lưu, trả access token mới cho interceptor.
setUnauthorizedHandler(async () => {
  try {
    const res = await refreshSession();
    if (!res) return null;
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
