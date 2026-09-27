import { create } from 'zustand';
import axios from 'axios';
import { newDeviceId } from '../utils/idempotency';
import { setStorage, getStorage, removeStorage } from 'zmp-sdk/apis';
import type { AuthUser, LoginResponse } from '@tubutree/shared-types';
import {
  ensurePhoneApi,
  loginGuest,
  loginZaloMiniApp,
  refreshTokens,
  setAccessToken,
  setAuthReady,
  setUnauthorizedHandler,
} from '../services/api';
import { getZaloAccessToken, requestZaloPhoneToken, getLaunchReferral } from '../services/zmp-bridge';

const REFRESH_KEY = 'tubu_refresh_token';
const DEVICE_KEY = 'tubu_device_id';

/** ID thiết bị ổn định cho đăng nhập khách (tạo 1 lần, lưu ZMP storage). */
export async function getDeviceId(): Promise<string> {
  const res = await getStorage({ keys: [DEVICE_KEY] });
  const existing = (res as Record<string, unknown>)[DEVICE_KEY];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  // deviceId là thứ DUY NHẤT xác thực tài khoản khách — phải sinh bằng crypto (xem newDeviceId).
  const id = newDeviceId();
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
 * Chỉ coi là "BE từ chối refresh token" (hết hạn/đã bị xoay — nghiệp vụ, nên xoá token đã lưu)
 * khi có response 401/403 thật từ server. Lỗi KHÔNG có response (mất mạng/timeout/CORS) không
 * chứng minh được token đã hỏng — xoá nhầm bắt user đăng nhập lại dù token vẫn còn dùng được,
 * lần sau tự retry là đủ.
 */
function isRefreshRejected(err: unknown): boolean {
  return axios.isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403);
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

/**
 * Nâng cấp NGẦM một phiên khách sang Zalo thật khi Zalo giờ đã khả dụng (A7-01) — chạy NỀN sau
 * khi app đã vào được với phiên khách, KHÔNG chặn UI, KHÔNG xin SĐT (không gọi requestZaloPhoneToken()).
 * Dùng chung endpoint an toàn với ensurePhone(): BE (AuthService.ensurePhoneForCurrentUser) tự
 * quyết định nâng cấp tại chỗ / gộp / từ chối — không bao giờ âm thầm đổi sang MỘT USER KHÁC bỏ
 * lại giỏ/địa chỉ/điểm của phiên khách. Lỗi (Zalo vẫn chưa khả dụng, mất mạng...) bị nuốt — giữ
 * nguyên phiên khách hiện tại, không ảnh hưởng trải nghiệm, thử lại ở lần mở app kế tiếp.
 */
function upgradeGuestSilently(): Promise<void> {
  return (async () => {
    try {
      const { code, accessToken } = await getZaloAccessToken();
      const res = await ensurePhoneApi(code, accessToken);
      setAccessToken(res.accessToken);
      await persistRefresh(res.refreshToken);
      useAuthStore.setState({ user: res.user, status: 'authenticated' });
    } catch {
      /* Zalo vẫn chưa khả dụng / lỗi khác — giữ nguyên phiên khách, thử lại ở lần mở app sau. */
    }
  })();
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

  /**
   * Mở app: ưu tiên refresh token đã lưu; nếu chưa có → silent Zalo login (không xin SĐT).
   *
   * Trong lúc chạy, mọi request khác bị giữ lại ở interceptor (setAuthReady) để không bay đi
   * khi chưa có access token. Mở app từ push/deeplink là đúng tình huống đó: trang đích fetch
   * ngay, request đi trần → 401, và React Query (retry:false cho 4xx) kẹt luôn màn lỗi.
   */
  restore: async () => {
    set({ status: 'loading' });
    const done = (async () => {
      try {
        const res = await refreshSession();
        if (res) {
          setAccessToken(res.accessToken);
          await persistRefresh(res.refreshToken);
          set({ user: res.user, status: 'authenticated' });
          // A7-01 (audit 2026-09): trước đây restore() ưu tiên refresh token khách đã lưu và
          // KHÔNG BAO GIỜ thử lại Zalo một khi đã có phiên khách hợp lệ (nhánh dưới "đăng nhập
          // ngầm bằng Zalo" chỉ chạy khi refreshSession() KHÔNG trả về gì) → thiết bị kẹt ở
          // tài khoản khách vĩnh viễn dù Zalo giờ đã đăng nhập được. Chạy NỀN (không chặn UI,
          // không xin SĐT) mỗi lần mở app với phiên khách để tự "tốt nghiệp" sang Zalo thật
          // ngay khi có thể — an toàn vì dùng chung endpoint không bao giờ âm thầm đổi user.
          if (res.user.zaloId?.startsWith('guest_')) void upgradeGuestSilently();
          return;
        }
      } catch (err) {
        if (isRefreshRejected(err)) await clearRefresh();
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
    })();
    setAuthReady(done);
    try {
      await done;
    } finally {
      setAuthReady(null);
    }
  },

  // Xin SĐT (sheet native) rồi đính vào tài khoản hiện tại.
  ensurePhone: async (): Promise<string | null> => {
    const current = get().user;
    if (current?.phone) return current.phone;
    const phoneToken = await requestZaloPhoneToken();
    if (!phoneToken) return null;
    try {
      const { code, accessToken } = await getZaloAccessToken();
      // A7-01 (audit 2026-09): KHÔNG gọi loginZaloMiniApp() ở đây — đó là đăng nhập TỪ ĐẦU,
      // không biết phiên hiện tại là ai nên có thể âm thầm trả token của MỘT USER KHÁC (đúng
      // lỗi đang vá: khách bị đổi sang tài khoản Zalo khác đang đăng nhập trên máy, bỏ lại
      // giỏ/địa chỉ/điểm của phiên khách). ensurePhoneApi() gửi kèm access token CỦA PHIÊN
      // HIỆN TẠI (interceptor tự đính Authorization) — BE biết chính xác đang là ai và chỉ đổi
      // danh tính khi an toàn (nâng cấp tại chỗ hoặc gộp khách→Zalo), không bao giờ âm thầm.
      const res = await ensurePhoneApi(code, accessToken, phoneToken);
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
  } catch (err) {
    if (isRefreshRejected(err)) await clearRefresh();
    useAuthStore.setState({ user: null, status: 'idle' });
    return null;
  }
});
