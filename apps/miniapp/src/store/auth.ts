import { create } from 'zustand';
import { newDeviceId } from '../utils/idempotency';
import { setStorage, getStorage, removeStorage } from 'zmp-sdk/apis';
import type { AuthUser, LoginResponse } from '@tubutree/shared-types';
import {
  api,
  ensurePhoneApi,
  getErrorMessage,
  loginGuest,
  loginZaloMiniApp,
  refreshTokens,
  setAccessToken,
  setAuthReady,
  setUnauthorizedHandler,
} from '../services/api';
import { getZaloAccessToken, requestZaloPhoneToken, getLaunchReferral } from '../services/zmp-bridge';
import { loadFirstTouch } from '../services/first-touch';
import { vi } from '../i18n/vi';
import { clearHomeHints, dropForeignHomeHints } from '@tubutree/app-core/home-layout';
import { browserStorage } from '../utils/recently-viewed';
import { isHttpError } from '../services/http';
import { isGuestUser } from '../utils/guest-user';
import { clearCtvTouched } from './storefront-context';
import { CATALOG_KEYS, getQueryClient } from '../services/query-client';
import { errorCode } from '@tubutree/app-core/api/error-status';

const REFRESH_KEY = 'tubu_refresh_token';
const DEVICE_KEY = 'tubu_device_id';
/** Thông tin hoá đơn khách nhập ở checkout (pages/checkout.tsx); máy dùng chung không được để người sau thấy. */
const INVOICE_KEY = 'tubu_invoice';

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
  /**
   * 'idle' = chưa/không còn đăng nhập (khách thật sự); 'error' = KHÔNG biết được vì mất mạng/API lỗi lúc khôi phục
   * phiên (chưa phải khách: trang phải nói mất kết nối và cho thử lại, xem hooks/use-auth-phase.ts).
   */
  status: 'idle' | 'loading' | 'authenticated' | 'error';
  /** Câu tiếng Việt cho khách đọc; không bao giờ là message thô của trình duyệt. */
  error?: string;
  /** Đăng nhập ngầm (không xin SĐT) — dùng khi mở app. */
  login: () => Promise<void>;
  restore: () => Promise<void>;
  /** Xin + đính SĐT vào tài khoản (gọi đúng lúc cần: checkout). Trả phone hoặc null, lỗi nào cũng thành null. */
  ensurePhone: () => Promise<string | null>;
  /** Như ensurePhone nhưng lỗi API (409 SĐT đã gắn tài khoản khác, mất mạng, 5xx) được ném để nút liên kết nói đúng lý do. Khách từ chối sheet thì vẫn trả null. */
  ensurePhoneOrThrow: () => Promise<string | null>;
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
  return isHttpError(err) && (err.response?.status === 401 || err.response?.status === 403);
}

/** Máy chủ trả lời "tài khoản đã bị khoá" (401 ACCOUNT_BLOCKED) ở đăng nhập hoặc refresh. */
function isAccountBlocked(err: unknown): boolean {
  return isHttpError(err) && err.response?.status === 401 && errorCode(err) === 'ACCOUNT_BLOCKED';
}

/**
 * Lỗi tạm của lời gọi phiên: không tới được máy chủ, quá thời gian, 429, 5xx. Chưa nói được khách là ai, nên không được
 * đẩy họ sang tài khoản Khách (mất điểm, giỏ, đơn đang hiện); app giữ phiên cũ và thử lại (hooks/use-auth-phase.ts).
 */
function isTransientSessionError(err: unknown): boolean {
  if (!isHttpError(err)) return false;
  const status = err.response?.status;
  return !status || status === 408 || status === 429 || status >= 500;
}

/** Lời cho khách khi chưa vào được phiên vì lỗi tạm: bị giới hạn tốc độ thì nói đúng vậy (mạng vẫn ổn), còn lại là mất kết nối. */
function sessionErrorText(err: unknown): string {
  return isHttpError(err) && err.response?.status === 429 ? vi.errors.sessionRateLimited : vi.errors.sessionUnavailable;
}

/**
 * Tài khoản bị khoá: bỏ phiên trên máy và đưa lời máy chủ ra cho khách đọc (hiện ở lời mời đăng nhập, components/ui/auth-gate.tsx).
 * Dọn cache như đăng xuất: query `enabled: authed` không còn chạy, nhưng số điểm/ví đã tải vẫn hiện nếu cache còn.
 */
async function applyBlocked(err: unknown): Promise<void> {
  setAccessToken(null);
  await clearRefresh();
  useAuthStore.setState({ user: null, status: 'idle', error: getErrorMessage(err) });
  onLogoutCleanup?.();
}

type ZaloAttempt = { kind: 'ok'; res: LoginResponse } | { kind: 'guest' } | { kind: 'stop' };

/**
 * Đăng nhập Zalo ngầm cho login() và restore(). Chỉ khi Zalo KHÔNG khả dụng trên máy (SDK lỗi, -1401, ngoài Zalo) mới trả
 * 'guest' để rơi xuống tài khoản Khách. Máy chủ đã trả lời lỗi tạm hoặc khoá thì 'stop' (trạng thái đã đặt xong): đăng nhập
 * khách lúc đó sẽ lặng lẽ đổi khách quen sang tài khoản Khách trống. `keepSession` = đang đăng nhập sẵn, không hạ xuống lỗi.
 */
async function tryZaloLogin(ref: string | undefined, firstTouch: Awaited<ReturnType<typeof loadFirstTouch>>, keepSession: boolean): Promise<ZaloAttempt> {
  let creds: Awaited<ReturnType<typeof getZaloAccessToken>>;
  try {
    creds = await getZaloAccessToken();
  } catch {
    return { kind: 'guest' };
  }
  try {
    const res = await loginZaloMiniApp(creds.code, creds.accessToken, undefined, ref, firstTouch);
    setAccessToken(res.accessToken);
    await persistRefresh(res.refreshToken);
    return { kind: 'ok', res };
  } catch (err) {
    // Khoá là kết luận chắc chắn, không phải lỗi tạm: kể cả khi đang đăng nhập sẵn cũng phải bỏ phiên và báo khách.
    if (isAccountBlocked(err)) {
      await applyBlocked(err);
      return { kind: 'stop' };
    }
    if (isTransientSessionError(err)) {
      if (!keepSession) useAuthStore.setState({ status: 'error', error: sessionErrorText(err) });
      return { kind: 'stop' };
    }
    // 4xx khác (Zalo từ chối access token...): vào bằng khách như trước.
    return { kind: 'guest' };
  }
}

/**
 * Đăng nhập ngầm không xin SĐT, dùng chung cho login() và restore(): Zalo trước, Zalo không khả dụng thì Khách theo deviceId
 * (app vẫn dùng được đầy đủ). Lỗi mạng/máy chủ ở cả hai bước là 'error' với câu tiếng Việt để UI báo "thử lại" thay vì im lặng,
 * trừ khi đang giữ một phiên đăng nhập sẵn (`keepSession`); khoá thì luôn báo.
 */
async function silentLogin(keepSession: boolean): Promise<void> {
  const ref = getLaunchReferral();
  const firstTouch = await loadFirstTouch();
  const zalo = await tryZaloLogin(ref, firstTouch, keepSession);
  if (zalo.kind === 'ok') {
    useAuthStore.setState({ user: zalo.res.user, status: 'authenticated' });
    return;
  }
  if (zalo.kind === 'stop') return;
  try {
    const res = await loginGuest(await getDeviceId(), ref, firstTouch);
    setAccessToken(res.accessToken);
    await persistRefresh(res.refreshToken);
    useAuthStore.setState({ user: res.user, status: 'authenticated' });
  } catch (err) {
    if (isAccountBlocked(err)) await applyBlocked(err);
    else if (!keepSession) useAuthStore.setState({ status: 'error', error: sessionErrorText(err) });
  }
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
    await silentLogin(false);
  },

  /**
   * Mở app: ưu tiên refresh token đã lưu; nếu chưa có → silent Zalo login (không xin SĐT).
   *
   * Trong lúc chạy, mọi request khác bị giữ lại ở interceptor (setAuthReady) để không bay đi
   * khi chưa có access token. Mở app từ push/deeplink là đúng tình huống đó: trang đích fetch
   * ngay, request đi trần → 401, và React Query (retry:false cho 4xx) kẹt luôn màn lỗi.
   */
  restore: async () => {
    // Làm mới một phiên ĐANG đăng nhập (vd sau khi đặt hàng để cập nhật số dư): không nháy 'loading' và không bao giờ hạ
    // phiên xuống 'error' chỉ vì lần làm mới này gặp lỗi mạng — khách vẫn đang đăng nhập với token còn dùng được.
    const keepSession = get().status === 'authenticated' && get().user !== null;
    if (!keepSession) set({ status: 'loading', error: undefined });
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
        if (isRefreshRejected(err)) {
          await clearRefresh();
        } else if (isTransientSessionError(err)) {
          // Máy còn refresh token nhưng chưa hỏi được máy chủ: đăng nhập lại từ đầu sẽ đổi khách quen sang tài khoản khác
          // (hoặc Khách). Giữ token, báo mất kết nối; useSessionRecovery gọi restore() lại.
          if (!keepSession) set({ status: 'error', error: sessionErrorText(err) });
          return;
        }
      }
      // Chưa có phiên hợp lệ → đăng nhập ngầm bằng Zalo, không có thì Khách (im lặng, không sheet SĐT).
      await silentLogin(keepSession);
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
    try {
      return await get().ensurePhoneOrThrow();
    } catch {
      return null;
    }
  },

  ensurePhoneOrThrow: async (): Promise<string | null> => {
    const current = get().user;
    if (current?.phone) return current.phone;
    // Chưa có phiên (đăng nhập lỗi/đang khoá): không mở sheet xin SĐT cho một lời gọi chắc chắn bị từ chối.
    if (!current) return null;
    const phoneToken = await requestZaloPhoneToken();
    if (!phoneToken) return null;
    // Zalo không khả dụng (ngoài Zalo, -1401) thì không liên kết được: coi như khách không cho phép, không phải lỗi máy chủ.
    let creds: Awaited<ReturnType<typeof getZaloAccessToken>>;
    try {
      creds = await getZaloAccessToken();
    } catch {
      return null;
    }
    // A7-01 (audit 2026-09): KHÔNG gọi loginZaloMiniApp() ở đây — đó là đăng nhập TỪ ĐẦU,
    // không biết phiên hiện tại là ai nên có thể âm thầm trả token của MỘT USER KHÁC (đúng
    // lỗi đang vá: khách bị đổi sang tài khoản Zalo khác đang đăng nhập trên máy, bỏ lại
    // giỏ/địa chỉ/điểm của phiên khách). ensurePhoneApi() gửi kèm access token CỦA PHIÊN
    // HIỆN TẠI (interceptor tự đính Authorization) — BE biết chính xác đang là ai và chỉ đổi
    // danh tính khi an toàn (nâng cấp tại chỗ hoặc gộp khách→Zalo), không bao giờ âm thầm.
    const res = await ensurePhoneApi(creds.code, creds.accessToken, phoneToken);
    setAccessToken(res.accessToken);
    await persistRefresh(res.refreshToken);
    set({ user: res.user, status: 'authenticated' });
    return res.user.phone ?? null;
  },

  logout: async () => {
    // Đọc trước khi xoá: sau đó không còn token để thu hồi trên máy chủ.
    const refreshToken = await readRefresh().catch(() => null);
    setAccessToken(null);
    await clearRefresh();
    set({ user: null, status: 'idle', error: undefined });
    clearHomeHints(browserStorage());
    clearCtvTouched();
    try {
      browserStorage()?.removeItem(INVOICE_KEY);
    } catch {
      /* storage bị chặn: không có gì để xoá */
    }
    // Xoá sạch cache React Query (ví, lương, hoa hồng...) — không để lộ dữ liệu tài
    // chính của user vừa đăng xuất cho user kế tiếp trên cùng thiết bị dùng chung
    // (VD tablet chấm công cửa hàng). Đăng ký qua setLogoutCleanup() ở app.tsx để
    // tránh import vòng (store/auth.ts <-> components/app.tsx).
    onLogoutCleanup?.();
    // Không chờ: đăng xuất trên máy không phụ thuộc mạng. Token còn sống trên máy chủ chỉ là lỗi dọn dẹp, tự hết hạn.
    if (refreshToken) {
      void api.post('/auth/logout', { refreshToken }).catch((err: unknown) => {
        console.warn('[auth] Chưa thu hồi được refresh token trên máy chủ:', err);
      });
    }
  },
}));

// Đăng nhập/khôi phục ra tài khoản khác với người dùng máy này lần trước: bỏ gợi ý khung chờ Trang chủ của người đó
// (loại khách, số dòng Việc cần làm), kẻo lần mở sau dựng khung theo loại khách của họ.
useAuthStore.subscribe((s, prev) => {
  const id = s.user?.id;
  if (id && id !== prev.user?.id) dropForeignHomeHints(browserStorage(), id);
  // Khách liên kết Zalo và được gộp sang tài khoản khác (id đổi) hoặc nâng lên Zalo tại chỗ (cùng id, hết là khách) ngay trong
  // phiên: điểm, giỏ, đơn, vườn trong cache vẫn là của tài khoản Khách. Lần đăng nhập đầu (chưa có user trước) và đăng xuất
  // (user về null; app.tsx đã clear cache) không cần.
  if (prev.user?.id && s.user && (s.user.id !== prev.user.id || (isGuestUser(prev.user) && !isGuestUser(s.user)))) {
    void getQueryClient()?.invalidateQueries({ predicate: (q) => !CATALOG_KEYS.some((k) => q.queryKey[0] === k[0]) });
  }
});

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
    if (isRefreshRejected(err)) {
      await clearRefresh();
      useAuthStore.setState({ user: null, status: 'idle', error: isAccountBlocked(err) ? getErrorMessage(err) : undefined });
      onLogoutCleanup?.();
    } else {
      // Mạng/429/5xx: chưa biết phiên còn hay không. 'error' (như restore()) để useSessionRecovery tự thử lại, thay vì mời đăng nhập.
      useAuthStore.setState({ status: 'error', error: sessionErrorText(err) });
    }
    return null;
  }
});
