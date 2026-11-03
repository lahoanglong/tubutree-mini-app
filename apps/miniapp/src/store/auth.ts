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

/**
 * Trần thời gian cho storage của ZMP ở đường đăng nhập. Cầu nối native không trả lời thì đăng nhập treo mãi, và vì login() gộp
 * các lần bấm chồng nhau, mọi lần bấm sau cũng im lặng theo. Hết trần là lỗi tạm (isTransientSessionError): báo câu lỗi máy (vi.errors.sessionStorage), giữ
 * refresh token, không rơi xuống tài khoản Khách.
 */
const AUTH_STORAGE_TIMEOUT_MS = 3000;
/** Storage của ZMP ném lỗi hay không trả lời: lỗi của máy, không phải của mạng hay tài khoản. */
class StorageFailure extends Error {}
class StorageTimeoutError extends StorageFailure {}
function withStorageTimeout<T>(call: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new StorageTimeoutError('ZMP storage timeout')), AUTH_STORAGE_TIMEOUT_MS);
    const fail = (e: unknown) => {
      clearTimeout(t);
      reject(new StorageFailure(e instanceof Error ? e.message : 'ZMP storage error'));
    };
    try {
      call().then((v) => {
        clearTimeout(t);
        resolve(v);
      }, fail);
    } catch (e) {
      fail(e);
    }
  });
}

/** Id vừa sinh mà lần ghi hết trần (có thể vẫn đang ghi): lần sau dùng lại đúng id này, id khác là một tài khoản Khách khác. */
let unsavedDeviceId: string | null = null;

/** ID thiết bị ổn định cho đăng nhập khách (tạo 1 lần, lưu ZMP storage). */
export async function getDeviceId(): Promise<string> {
  // Không đọc được thì ném, không sinh id mới: id mới là một tài khoản Khách khác.
  const res = await withStorageTimeout(() => getStorage({ keys: [DEVICE_KEY] }));
  const existing = (res as Record<string, unknown>)[DEVICE_KEY];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  // deviceId là thứ DUY NHẤT xác thực tài khoản khách — phải sinh bằng crypto (xem newDeviceId).
  const id = (unsavedDeviceId ??= newDeviceId());
  await withStorageTimeout(() => setStorage({ data: { [DEVICE_KEY]: id } }));
  unsavedDeviceId = null;
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
  await withStorageTimeout(() => setStorage({ data: { [REFRESH_KEY]: token } }));
}
async function readRefresh({ limit = true }: { limit?: boolean } = {}): Promise<string | null> {
  const read = () => getStorage({ keys: [REFRESH_KEY] });
  const res = await (limit ? withStorageTimeout(read) : read());
  const val = (res as Record<string, unknown>)[REFRESH_KEY];
  return typeof val === 'string' && val.length > 0 ? val : null;
}
async function clearRefresh(): Promise<void> {
  unpersistedRefresh = null;
  // Xoá treo hay hỏng thì bỏ qua: chỉ gọi khi máy chủ đã từ chối token này (khoá, hết hạn, đã xoay) nên token còn lại cũng bị từ chối
  // ở lần refresh sau, còn chờ hay ném thì kẹt cả báo khoá. Đăng xuất không dùng hàm này (xem logout).
  await withStorageTimeout(() => removeStorage({ keys: [REFRESH_KEY] })).catch((e: unknown) => {
    if (!(e instanceof StorageFailure)) throw e;
  });
}

/**
 * Mỗi lần logout() bắt đầu là sang một đời mới. Đường tạo phiên (khôi phục, handler 401, đăng nhập, liên kết SĐT, nâng cấp khách) chụp
 * đời lúc bắt đầu; máy chủ trả lời sau một lần đăng xuất thì kết quả bị bỏ, kẻo máy dùng chung tự đăng nhập lại người vừa thoát.
 */
let sessionEpoch = 0;
/** logout() đang chờ storage. Trong khe đó token cũ còn trên máy: đường tạo phiên phải chờ xong, kẻo đọc lại token cũ và xoay nó. */
let logoutInFlight: Promise<void> | null = null;
/** Storage treo thì logout treo theo (xem logout): chờ tới trần rồi đi tiếp, để bước đọc storage kế tiếp tự báo lỗi máy thay vì treo mãi. */
const afterLogout = (): Promise<unknown> => (logoutInFlight ? withStorageTimeout(() => logoutInFlight!).catch(() => undefined) : Promise.resolve());

/** Refresh token mới mà storage không ghi được: giữ trong bộ nhớ để refresh của phiên này vẫn chạy, khỏi đá khách ra. */
let unpersistedRefresh: string | null = null;

function revokeInBackground(refreshToken: string): void {
  void api.post('/auth/logout', { refreshToken }).catch((err: unknown) => {
    console.warn('[auth] Chưa thu hồi được refresh token trên máy chủ:', err);
  });
}

/** Số thứ tự lần nhận phiên gần nhất: lần nhận cũ chỉ được xoá access token nếu chưa có lần nhận nào mới hơn. */
let lastAdoptId = 0;

/**
 * Nhận phiên máy chủ vừa trả. false = một lần logout() đã bắt đầu từ lúc `epoch` được chụp: không đặt token, không lưu refresh,
 * refresh token mới được thu hồi, người gọi không đổi user/status. Lưu refresh hỏng hay quá hạn thì vẫn vào phiên (token ở bộ nhớ).
 */
async function adoptSession(res: LoginResponse, epoch: number): Promise<boolean> {
  if (epoch !== sessionEpoch) {
    revokeInBackground(res.refreshToken);
    return false;
  }
  const adoptId = ++lastAdoptId;
  setAccessToken(res.accessToken);
  let saved = true;
  try {
    await persistRefresh(res.refreshToken);
  } catch {
    saved = false;
  }
  if (epoch !== sessionEpoch) {
    // Đăng xuất chen vào lúc đang ghi: lần ghi có thể đáp sau lần xoá của logout. Phiên mới đã nhận token sau đó thì để nguyên.
    if (adoptId === lastAdoptId) setAccessToken(null);
    revokeInBackground(res.refreshToken);
    // Chỉ xoá khi máy còn đúng token vừa ghi: một đăng nhập mới có thể đã ghi token khác lên trên.
    void readRefresh({ limit: false })
      .then((stored) => (stored === res.refreshToken ? removeStorage({ keys: [REFRESH_KEY] }) : undefined))
      .catch(() => undefined);
    return false;
  }
  unpersistedRefresh = saved ? null : res.refreshToken;
  return true;
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
  if (err instanceof StorageFailure) return true;
  if (!isHttpError(err)) return false;
  const status = err.response?.status;
  return !status || status === 408 || status === 429 || status >= 500;
}

/** Lời cho khách khi chưa vào được phiên vì lỗi tạm: bị giới hạn tốc độ thì nói đúng vậy (mạng vẫn ổn), còn lại là mất kết nối. */
function sessionErrorText(err: unknown): string {
  if (err instanceof StorageFailure) return vi.errors.sessionStorage;
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
async function tryZaloLogin(
  ref: string | undefined,
  firstTouch: Awaited<ReturnType<typeof loadFirstTouch>>,
  keepSession: boolean,
  epoch: number,
): Promise<ZaloAttempt> {
  let creds: Awaited<ReturnType<typeof getZaloAccessToken>>;
  try {
    creds = await getZaloAccessToken();
  } catch {
    return { kind: 'guest' };
  }
  try {
    const res = await loginZaloMiniApp(creds.code, creds.accessToken, undefined, ref, firstTouch);
    return (await adoptSession(res, epoch)) ? { kind: 'ok', res } : { kind: 'stop' };
  } catch (err) {
    if (epoch !== sessionEpoch) return { kind: 'stop' };
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
async function silentLogin(keepSession: boolean, epoch: number): Promise<void> {
  const ref = getLaunchReferral();
  const firstTouch = await loadFirstTouch();
  if (epoch !== sessionEpoch) return;
  const zalo = await tryZaloLogin(ref, firstTouch, keepSession, epoch);
  if (zalo.kind === 'ok') {
    useAuthStore.setState({ user: zalo.res.user, status: 'authenticated' });
    return;
  }
  if (zalo.kind === 'stop') return;
  try {
    const res = await loginGuest(await getDeviceId(), ref, firstTouch);
    if (!(await adoptSession(res, epoch))) return;
    useAuthStore.setState({ user: res.user, status: 'authenticated' });
  } catch (err) {
    if (epoch !== sessionEpoch) return;
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
  if (refreshInFlight) return refreshInFlight;
  const p = (async () => {
    await afterLogout();
    // Hết trần mà logout vẫn chưa xong: token cũ còn trên máy, đọc ra xoay là dựng lại phiên của người vừa thoát.
    if (logoutInFlight) throw new StorageTimeoutError('logout chưa xong');
    const token = unpersistedRefresh ?? (await readRefresh());
    if (!token) return null;
    return refreshTokens(token);
  })();
  refreshInFlight = p;
  const clear = () => {
    if (refreshInFlight === p) refreshInFlight = null;
  };
  p.then(clear, clear);
  return p;
}

/**
 * restore() và login() đang chạy. Mỗi bên gộp các lần gọi chồng nhau của chính nó làm một, và bên đến sau chờ bên đang chạy xong
 * thay vì đăng nhập song song (bên xong sau sẽ đè phiên của bên kia, hai bên cùng xoay refresh token).
 */
let restoreInFlight: Promise<void> | null = null;
let loginInFlight: Promise<void> | null = null;
/** Số restore() đang đỗ chờ logout: login() không chờ chúng (chúng chờ login), kể cả khi logout vừa xong. */
let restoreParked = 0;

/**
 * Nâng cấp NGẦM một phiên khách sang Zalo thật khi Zalo giờ đã khả dụng (A7-01) — chạy NỀN sau
 * khi app đã vào được với phiên khách, KHÔNG chặn UI, KHÔNG xin SĐT (không gọi requestZaloPhoneToken()).
 * Dùng chung endpoint an toàn với ensurePhone(): BE (AuthService.ensurePhoneForCurrentUser) tự
 * quyết định nâng cấp tại chỗ / gộp / từ chối — không bao giờ âm thầm đổi sang MỘT USER KHÁC bỏ
 * lại giỏ/địa chỉ/điểm của phiên khách. Lỗi (Zalo vẫn chưa khả dụng, mất mạng...) bị nuốt — giữ
 * nguyên phiên khách hiện tại, không ảnh hưởng trải nghiệm, thử lại ở lần mở app kế tiếp.
 */
function upgradeGuestSilently(): Promise<void> {
  const epoch = sessionEpoch;
  return (async () => {
    try {
      const { code, accessToken } = await getZaloAccessToken();
      const res = await ensurePhoneApi(code, accessToken);
      if (!(await adoptSession(res, epoch))) return;
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

  login: () => {
    if (loginInFlight) return loginInFlight;
    const epoch = sessionEpoch;
    // Chụp ngay lúc gọi, trước mọi await. Lúc logout còn chờ thì không chờ restore nào: restore bắt đầu trong khe đó đang chờ chính
    // login này (xem restore), chờ lại nhau là treo mãi.
    const logoutPending = logoutInFlight !== null;
    const restoreAtStart = logoutPending || restoreParked > 0 ? null : restoreInFlight;
    const run = (async () => {
      if (logoutPending) await afterLogout();
      // Bấm đăng nhập lúc app còn đang khôi phục phiên: chờ khôi phục xong. Khôi phục ra phiên rồi thì thôi, vì đăng nhập
      // lại từ đầu song song sẽ ghi đè phiên vừa khôi phục (có khi bằng phiên Khách) và hai bên xoay refresh token dẫm lên nhau.
      if (restoreAtStart) {
        await restoreAtStart.catch(() => undefined);
        const { status, error } = get();
        // Khôi phục hỏng vì storage: máy còn refresh token mà chưa đọc được, đăng nhập lại từ đầu sẽ đổi khách quen sang tài khoản khác.
        if (status === 'authenticated' || (status === 'error' && error === vi.errors.sessionStorage)) return;
      }
      if (epoch !== sessionEpoch) return;
      set({ status: 'loading', error: undefined });
      await silentLogin(false, epoch);
    })();
    const tracked = run.finally(() => {
      if (loginInFlight === tracked) loginInFlight = null;
    });
    loginInFlight = tracked;
    return tracked;
  },

  /**
   * Mở app: ưu tiên refresh token đã lưu; nếu chưa có → silent Zalo login (không xin SĐT).
   *
   * Trong lúc chạy, mọi request khác bị giữ lại ở interceptor (setAuthReady) để không bay đi
   * khi chưa có access token. Mở app từ push/deeplink là đúng tình huống đó: trang đích fetch
   * ngay, request đi trần → 401, và React Query (retry:false cho 4xx) kẹt luôn màn lỗi.
   */
  restore: () => {
    // Chạm đúp Thử lại, hay useSessionRecovery gọi lúc app còn đang khôi phục: dùng chung lần đang chạy.
    if (restoreInFlight) return restoreInFlight;
    // Làm mới một phiên ĐANG đăng nhập (vd sau khi đặt hàng để cập nhật số dư): không nháy 'loading' và không bao giờ hạ
    // phiên xuống 'error' chỉ vì lần làm mới này gặp lỗi mạng — khách vẫn đang đăng nhập với token còn dùng được.
    const epoch = sessionEpoch;
    let keepSession = get().status === 'authenticated' && get().user !== null;
    if (!keepSession) set({ status: 'loading', error: undefined });
    const done = (async () => {
      if (logoutInFlight) {
        restoreParked += 1;
        try {
          await afterLogout();
        } finally {
          restoreParked -= 1;
        }
        if (epoch !== sessionEpoch) return;
        // Phiên đang đăng nhập lúc gọi đã bị logout bỏ: từ đây là khôi phục thường, lỗi tạm phải đặt được 'error'.
        keepSession = false;
        set({ status: 'loading', error: undefined });
      }
      // Đăng nhập đang chạy (vd handler 401 vừa đưa phiên về 'error' giữa lúc đăng nhập): chờ nó. Ra phiên hay bị khoá ('idle'
      // kèm lời máy chủ) là đã có kết luận, đăng nhập lại chỉ có thể làm sai kết luận đó. Lỗi tạm, hay login() ném ra ngoài mà
      // phiên còn kẹt 'loading', thì khôi phục tiếp.
      if (loginInFlight) {
        await loginInFlight.catch(() => undefined);
        const after = get().status;
        if (after === 'authenticated' || after === 'idle') return;
      }
      if (epoch !== sessionEpoch) return;
      try {
        const res = await refreshSession();
        if (res) {
          if (!(await adoptSession(res, epoch))) return;
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
        if (epoch !== sessionEpoch) return;
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
      if (epoch !== sessionEpoch) return;
      await silentLogin(keepSession, epoch);
    })();
    setAuthReady(done);
    const tracked = done.finally(() => {
      if (restoreInFlight === tracked) {
        setAuthReady(null);
        restoreInFlight = null;
      }
    });
    restoreInFlight = tracked;
    return tracked;
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
    const epoch = sessionEpoch;
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
    if (!(await adoptSession(res, epoch))) return null;
    set({ user: res.user, status: 'authenticated' });
    return res.user.phone ?? null;
  },

  logout: () => {
    const p = (async () => {
      // Đồng bộ, trước mọi await: từ đây mọi phiên đang chờ máy chủ bị bỏ, và đăng nhập bắt đầu sau đó là một lần mới
      // (không gộp vào lần đang chạy của đời trước).
      sessionEpoch += 1;
      refreshInFlight = null;
      restoreInFlight = null;
      loginInFlight = null;
      setAuthReady(null);
      const memToken = unpersistedRefresh;
      unpersistedRefresh = null;
      // Không đặt trần ở đây: trên máy dùng chung, đăng xuất phải chắc đã đọc được token để thu hồi và đã xoá nó. Storage treo thì
      // đăng xuất treo theo (khách thấy chưa xong), còn hơn báo đã đăng xuất mà token vẫn nằm trên máy cho người sau mở lại.
      // Đọc trước khi xoá: sau đó không còn token để thu hồi trên máy chủ.
      const refreshToken = await readRefresh({ limit: false }).catch(() => null);
      setAccessToken(null);
      await removeStorage({ keys: [REFRESH_KEY] });
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
      if (refreshToken) revokeInBackground(refreshToken);
      if (memToken && memToken !== refreshToken) revokeInBackground(memToken);
    })();
    logoutInFlight = p;
    const clear = () => {
      if (logoutInFlight === p) logoutInFlight = null;
    };
    p.then(clear, clear);
    return p;
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
    void getQueryClient()?.invalidateQueries({
      predicate: (q) => !CATALOG_KEYS.some((k) => q.queryKey[0] === k[0]),
    });
  }
});

let onLogoutCleanup: (() => void) | null = null;
/** Đăng ký hàm dọn dẹp (vd queryClient.clear()) chạy sau khi logout thành công. */
export function setLogoutCleanup(fn: () => void): void {
  onLogoutCleanup = fn;
}

// Khi API gặp 401 → tự refresh bằng token đã lưu, trả access token mới cho interceptor.
setUnauthorizedHandler(async () => {
  const epoch = sessionEpoch;
  try {
    const res = await refreshSession();
    if (!res) return null;
    if (!(await adoptSession(res, epoch))) return null;
    useAuthStore.setState({ user: res.user, status: 'authenticated' });
    return res.accessToken;
  } catch (err) {
    if (epoch !== sessionEpoch) return null;
    if (isRefreshRejected(err)) {
      await clearRefresh();
      useAuthStore.setState({
        user: null,
        status: 'idle',
        error: isAccountBlocked(err) ? getErrorMessage(err) : undefined,
      });
      onLogoutCleanup?.();
    } else {
      // Mạng/429/5xx: chưa biết phiên còn hay không. 'error' (như restore()) để useSessionRecovery tự thử lại, thay vì mời đăng nhập.
      useAuthStore.setState({ status: 'error', error: sessionErrorText(err) });
    }
    return null;
  }
});
