'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  apiFetch,
  setAccessToken,
  hasSessionMarker,
  setSessionMarker,
  clearSessionMarker,
  restoreSession,
} from './client-api';
import { clearSavedInvoices } from './saved-invoice';
import { clearRecentCustomers } from '@/components/affiliate/recent-customers';
import { clearWizardStorage } from './recycle-wizard';
import { readFirstTouchCookie } from './entry-source';

export interface WebUser {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: string;
  pointsBalance: number;
  /** Lô Điểm Xanh quy đổi từ xu cũ (không hết hạn). Phiên cũ chưa có field → coi là 0. */
  pointsConvertedBalance?: number;
  walletBalance: number;
  referralCode: string;
}

interface LoginResponse {
  accessToken: string;
  /** Rỗng với web: refresh token đi bằng cookie HttpOnly, JS không được thấy nó. */
  refreshToken: string;
  user: WebUser;
}

interface AuthState {
  user: WebUser | null;
  status: 'idle' | 'loading' | 'authenticated';
  /**
   * false cho tới khi lượt khôi phục phiên lúc mở trang chạy xong.
   *
   * `status` khởi tạo là 'idle' và chỉ chuyển sang 'loading' TRONG useEffect, nên lần render đầu
   * tiên luôn là 'idle' — trang nào coi 'idle' = "chưa đăng nhập" sẽ chớp màn "Cần đăng nhập"
   * trước khi vào được. Không thể khởi tạo theo cờ phiên trong localStorage vì render phía
   * server không đọc được localStorage (lệch hydrate).
   */
  initialized: boolean;
  /**
   * true khi cờ phiên còn nhưng lượt khôi phục phiên hết lần thử vì mất mạng/API tạm lỗi (không phải phiên chết).
   * Khách vẫn đang đăng nhập: trang phải nói "không kết nối được" kèm nút thử lại, không hiện lời mời đăng nhập.
   */
  sessionUnavailable: boolean;
  /** Thử khôi phục phiên lại ngay (nút "Thử lại"); ngoài ra tự thử khi có mạng/quay lại tab. */
  retrySession: () => Promise<void>;
  /**
   * false khi bản build này không có NEXT_PUBLIC_ZALO_APP_ID: nút "Đăng nhập với Zalo" không thể hoạt động,
   * trang đăng nhập phải nói thẳng thay vì để khách bấm rồi gặp lỗi kỹ thuật.
   */
  zaloLoginConfigured: boolean;
  startZaloLogin: () => Promise<void>;
  handleCallback: (code: string, state: string | null) => Promise<void>;
  logout: () => Promise<void>;
  /** Cập nhật phần hồ sơ đã lưu thành công (vd đổi tên) để thanh đầu trang đổi theo ngay, không chờ đăng nhập lại. */
  updateProfile: (patch: Partial<Pick<WebUser, 'fullName' | 'avatarUrl'>>) => void;
}

const AuthContext = createContext<AuthState | null>(null);

const ZALO_APP_ID = process.env.NEXT_PUBLIC_ZALO_APP_ID ?? '';
const PKCE_KEY = 'tubu_pkce_verifier';
// CSRF/replay guard cho luồng OAuth: state ngẫu nhiên theo phiên, đối chiếu lại ở callback
// (trước đây hard-code "state=tubu" và callback không đọc lại — không chặn được login CSRF:
// kẻ tấn công dùng code Zalo của chính họ dụ nạn nhân mở link callback để bị đăng nhập
// nhầm vào tài khoản kẻ tấn công).
const STATE_KEY = 'tubu_oauth_state';

function randomString(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => ('0' + b.toString(16)).slice(-2)).join('');
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<WebUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('idle');
  const [initialized, setInitialized] = useState(false);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);

  // Khôi phục phiên từ cookie refresh (HttpOnly, do BE set). Cờ `tubu_web_session` trong
  // localStorage chỉ để biết CÓ ĐÁNG gọi hay không — khách vãng lai không tốn một lượt 401.
  // Lỗi tạm (mất mạng, API khởi động lại, 429) được thử lại vài lần và KHÔNG xoá cờ; chỉ 400/401/403
  // mới coi là phiên chết (client-api.ts xoá cờ). Lỗi tạm đánh dấu `sessionUnavailable` để trang không
  // coi khách đang đăng nhập là khách vãng lai.
  const restore = useCallback(async () => {
    const out = await restoreSession();
    if (out.kind === 'ok') {
      setUser((out.data as LoginResponse).user);
      setStatus('authenticated');
      setSessionUnavailable(false);
    } else {
      setStatus('idle');
      setSessionUnavailable(out.kind === 'transient');
    }
  }, []);

  const retrySession = useCallback(async () => {
    if (!hasSessionMarker()) {
      setSessionUnavailable(false);
      return;
    }
    await restore();
  }, [restore]);

  useEffect(() => {
    if (!hasSessionMarker()) {
      setStatus('idle');
      setInitialized(true);
      return;
    }
    setStatus('loading');
    void restore().finally(() => setInitialized(true));
  }, [restore]);

  // Mở trang lúc mất mạng: cờ phiên còn nhưng chưa vào được — có mạng lại hoặc quay lại tab thì thử tiếp.
  useEffect(() => {
    if (!initialized || status !== 'idle' || user) return;
    const retry = () => {
      if (document.visibilityState === 'visible' && hasSessionMarker()) void restore();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [initialized, status, user, restore]);

  const startZaloLogin = useCallback(async () => {
    if (!ZALO_APP_ID) {
      throw new Error('Đăng nhập Zalo chưa được cấu hình (thiếu NEXT_PUBLIC_ZALO_APP_ID).');
    }
    const verifier = randomString(48);
    sessionStorage.setItem(PKCE_KEY, verifier);
    const state = randomString(16);
    sessionStorage.setItem(STATE_KEY, state);
    const challenge = await sha256Base64Url(verifier);
    const redirectUri = `${window.location.origin}/dang-nhap/callback`;
    const url =
      `https://oauth.zaloapp.com/v4/permission?app_id=${encodeURIComponent(ZALO_APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code_challenge=${encodeURIComponent(challenge)}&state=${encodeURIComponent(state)}`;
    window.location.href = url;
  }, []);

  const handleCallback = useCallback(async (code: string, state: string | null) => {
    setStatus('loading');
    const expectedState = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    if (!expectedState || state !== expectedState) {
      setStatus('idle');
      throw new Error('Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.');
    }
    try {
      const codeVerifier = sessionStorage.getItem(PKCE_KEY) ?? undefined;
      const res = await apiFetch<LoginResponse>('/auth/zalo-oauth', {
        method: 'POST',
        // Nguồn chạm đầu (cookie 30 ngày): API chỉ ghi khi đây là lần tạo tài khoản, không bao giờ ghi đè.
        body: { code, codeVerifier, firstTouch: readFirstTouchCookie() },
        auth: false,
      });
      setAccessToken(res.accessToken);
      setSessionMarker();
      setUser(res.user);
      setStatus('authenticated');
      setSessionUnavailable(false);
    } catch (e) {
      // Không để `status` kẹt ở 'loading' khi trao đổi code thất bại — các trang khác
      // (giỏ hàng, thanh toán, admin) coi 'loading' là "đang kiểm tra phiên" nên sẽ
      // hiện loading vô hạn thay vì màn hình "cần đăng nhập".
      setStatus('idle');
      throw e;
    } finally {
      sessionStorage.removeItem(PKCE_KEY);
    }
  }, []);

  const logout = useCallback(async () => {
    // Gọi kể cả khi không thấy cờ: cookie thật có thể còn sống (cờ bị xoá nhầm/hết hạn lệch),
    // và chỉ BE mới thu hồi được token trong DB.
    await apiFetch('/auth/logout', { method: 'POST', body: {}, auth: false }).catch(() => {});
    setAccessToken(null);
    clearSessionMarker();
    setUser(null);
    setStatus('idle');
    setSessionUnavailable(false);
    qc.clear(); // xóa cache giỏ/đơn để không hiện dữ liệu user cũ
    clearSavedInvoices();
    clearRecentCustomers();
    clearWizardStorage();
  }, [qc]);

  const updateProfile = useCallback((patch: Partial<Pick<WebUser, 'fullName' | 'avatarUrl'>>) => {
    setUser((u) => (u ? { ...u, ...patch } : u));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        initialized,
        sessionUnavailable,
        retrySession,
        zaloLoginConfigured: !!ZALO_APP_ID,
        startZaloLogin,
        handleCallback,
        logout,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
