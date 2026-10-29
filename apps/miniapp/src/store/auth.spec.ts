// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

vi.mock('zmp-sdk/apis', () => ({
  setStorage: vi.fn(),
  getStorage: vi.fn(),
  removeStorage: vi.fn(),
}));
vi.mock('../services/api', async (importOriginal) => ({
  // getErrorMessage thật: lời "bị khoá" phải đúng là lời máy chủ qua cùng hàm các màn đang dùng.
  ...(await importOriginal<Record<string, unknown>>()),
  api: { post: vi.fn() },
  setAccessToken: vi.fn(),
  setAuthReady: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  loginGuest: vi.fn(),
  loginZaloMiniApp: vi.fn(),
  refreshTokens: vi.fn(),
  ensurePhoneApi: vi.fn(),
}));
vi.mock('../services/zmp-bridge', () => ({
  getZaloAccessToken: vi.fn(),
  requestZaloPhoneToken: vi.fn(),
  getLaunchReferral: vi.fn(() => undefined),
}));

vi.mock('../services/first-touch', () => ({ loadFirstTouch: vi.fn(async () => undefined) }));

import { getStorage, setStorage, removeStorage } from 'zmp-sdk/apis';
import { loadFirstTouch } from '../services/first-touch';
import { api, loginGuest, loginZaloMiniApp, refreshTokens, setUnauthorizedHandler, ensurePhoneApi } from '../services/api';
import { HttpError } from '../services/http';
import { createQueryClient } from '../services/query-client';
import type { QueryClient } from '@tanstack/react-query';
import { getZaloAccessToken, requestZaloPhoneToken } from '../services/zmp-bridge';
import type { LoginResponse, AuthUser } from '@tubutree/shared-types';
import { useAuthStore, setLogoutCleanup } from './auth';
import { vi as copy } from '../i18n/vi';

const mockedGetStorage = vi.mocked(getStorage);
const mockedSetStorage = vi.mocked(setStorage);
const mockedRemoveStorage = vi.mocked(removeStorage);
const mockedLoginGuest = vi.mocked(loginGuest);
const mockedLoginZalo = vi.mocked(loginZaloMiniApp);
const mockedRefresh = vi.mocked(refreshTokens);
const mockedSetUnauthorizedHandler = vi.mocked(setUnauthorizedHandler);
const mockedGetZaloAccessToken = vi.mocked(getZaloAccessToken);
const mockedRequestZaloPhoneToken = vi.mocked(requestZaloPhoneToken);
const mockedEnsurePhoneApi = vi.mocked(ensurePhoneApi);
const mockedApiPost = vi.mocked(api.post);

const httpFail = (status?: number, data?: unknown) => new HttpError('fail', status ? undefined : 'ERR_NETWORK', status ? { status, data } : undefined);
const blocked = () => httpFail(401, { statusCode: 401, code: 'ACCOUNT_BLOCKED', message: 'Tài khoản đã bị khoá.' });

// auth.ts đăng ký handler 401 1 LẦN lúc module load (top-level side effect), TRƯỚC
// beforeEach đầu tiên — chụp lại ngay bây giờ, vì vi.clearAllMocks() trong beforeEach
// sẽ xoá sạch lịch sử gọi mock (kể cả lần gọi lúc load module này).
const unauthorizedHandler = mockedSetUnauthorizedHandler.mock.calls[0]?.[0];

function loginResponse(id: string, zaloId?: string): LoginResponse {
  return {
    accessToken: `access-${id}`,
    refreshToken: `refresh-${id}`,
    user: {
      id,
      zaloId,
      role: 'CUSTOMER',
      referralCode: 'REF1',
      pointsBalance: 0,
      walletBalance: 0,
      pointsConvertedBalance: 0,
    } as AuthUser,
  };
}

/** Flush cả microtask lẫn 1 vòng macrotask — dùng khi cần chờ một promise "chạy nền" (không được
 *  await trực tiếp, vd upgradeGuestSilently()) tiến thêm vài bước trước khi assert. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSetStorage.mockResolvedValue(undefined as never);
  mockedRemoveStorage.mockResolvedValue(undefined as never);
  mockedGetStorage.mockResolvedValue({});
  useAuthStore.setState({ user: null, status: 'loading', error: undefined });
});

describe('nguồn chạm đầu đi kèm đăng nhập tạo tài khoản', () => {
  const firstTouch = { source: 'shopee', campaign: 'card-2610', at: '2026-10-18T00:00:00.000Z' };

  beforeEach(() => {
    vi.mocked(loadFirstTouch).mockResolvedValue(firstTouch);
  });
  afterEach(() => {
    vi.mocked(loadFirstTouch).mockResolvedValue(undefined);
  });

  it('login(): gửi firstTouch ở đăng nhập Zalo', async () => {
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c', accessToken: 'a' });
    mockedLoginZalo.mockResolvedValue(loginResponse('u1', 'z1'));
    await useAuthStore.getState().login();
    expect(mockedLoginZalo).toHaveBeenCalledWith('c', 'a', undefined, undefined, firstTouch);
  });

  it('login(): Zalo lỗi → đăng nhập khách cũng gửi firstTouch', async () => {
    mockedGetZaloAccessToken.mockRejectedValue(new Error('not in zalo'));
    mockedLoginGuest.mockResolvedValue(loginResponse('g1'));
    await useAuthStore.getState().login();
    expect(mockedLoginGuest).toHaveBeenCalledWith(expect.any(String), undefined, firstTouch);
  });

  it('restore() không có phiên: đăng nhập Zalo và đăng nhập khách đều gửi firstTouch', async () => {
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c', accessToken: 'a' });
    mockedLoginZalo.mockRejectedValueOnce(new Error('zalo down'));
    mockedLoginGuest.mockResolvedValue(loginResponse('g1'));
    await useAuthStore.getState().restore();
    expect(mockedLoginZalo).toHaveBeenCalledWith('c', 'a', undefined, undefined, firstTouch);
    expect(mockedLoginGuest).toHaveBeenCalledWith(expect.any(String), undefined, firstTouch);
  });

  it('restore() bằng refresh token còn hạn: không đụng tới nguồn chạm đầu (tài khoản đã có không bị ghi lại)', async () => {
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'rt' });
    mockedRefresh.mockResolvedValue(loginResponse('u1', 'z1'));
    await useAuthStore.getState().restore();
    expect(loadFirstTouch).not.toHaveBeenCalled();
  });

  it('không có chạm đầu (mở app trần) → vẫn đăng nhập bình thường, tham số vắng', async () => {
    vi.mocked(loadFirstTouch).mockResolvedValue(undefined);
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c', accessToken: 'a' });
    mockedLoginZalo.mockResolvedValue(loginResponse('u1', 'z1'));
    await useAuthStore.getState().login();
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(mockedLoginZalo).toHaveBeenCalledWith('c', 'a', undefined, undefined, undefined);
  });
});

describe('useAuthStore.login — guest fallback', () => {
  it('Zalo chưa khả dụng (login lỗi) → tự fallback đăng nhập khách, app vẫn dùng được', async () => {
    mockedGetZaloAccessToken.mockRejectedValue(new Error('not in zalo'));
    mockedLoginGuest.mockResolvedValue(loginResponse('guest-1'));

    await useAuthStore.getState().login();

    expect(mockedLoginGuest).toHaveBeenCalledTimes(1);
    expect(mockedLoginZalo).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.id).toBe('guest-1');
  });

  it('cả Zalo lẫn guest đều lỗi (mất mạng/server) → status error, không treo vĩnh viễn ở loading', async () => {
    mockedGetZaloAccessToken.mockRejectedValue(new Error('not in zalo'));
    mockedLoginGuest.mockRejectedValue(new Error('Network Error'));

    await useAuthStore.getState().login();

    expect(useAuthStore.getState().status).toBe('error');
  });

  it('khách bị giới hạn tốc độ (429) ở loginGuest → status error, câu "thao tác quá nhanh"', async () => {
    mockedGetZaloAccessToken.mockRejectedValue(new Error('not in zalo'));
    mockedLoginGuest.mockRejectedValue(httpFail(429));

    await useAuthStore.getState().login();

    expect(useAuthStore.getState().status).toBe('error');
    expect(useAuthStore.getState().error).toBe(copy.errors.sessionRateLimited);
  });
});

describe('useAuthStore.restore — refresh dedup', () => {
  it('2 lời gọi restore() chồng nhau chỉ gọi refreshTokens 1 lần (BE xoay refresh token single-use)', async () => {
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh' });
    let resolveRefresh!: (v: LoginResponse) => void;
    mockedRefresh.mockReturnValue(
      new Promise<LoginResponse>((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const p1 = useAuthStore.getState().restore();
    const p2 = useAuthStore.getState().restore();
    resolveRefresh(loginResponse('u1'));
    await Promise.all([p1, p2]);

    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('chưa có refresh token lưu + Zalo chưa khả dụng → fallback khách theo deviceId', async () => {
    mockedGetStorage.mockResolvedValue({});
    mockedGetZaloAccessToken.mockRejectedValue(new Error('not in zalo'));
    mockedLoginGuest.mockResolvedValue(loginResponse('guest-2'));

    await useAuthStore.getState().restore();

    expect(mockedLoginGuest).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('refresh token đã lưu nhưng BE từ chối (401, hết hạn/đã bị xoay) → xoá refresh cũ rồi thử đăng nhập ngầm', async () => {
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'expired' });
    mockedRefresh.mockRejectedValue({ isHttpError: true, response: { status: 401 } });
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c1', accessToken: 'zalo-at' });
    mockedLoginZalo.mockResolvedValue(loginResponse('u2'));

    await useAuthStore.getState().restore();

    expect(mockedRemoveStorage).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.id).toBe('u2');
  });

  it('refresh lỗi mạng/timeout (không có response) mà máy còn refresh token → KHÔNG xoá token, KHÔNG đăng nhập lại từ đầu, status error để thử lại sau', async () => {
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh' });
    mockedRefresh.mockRejectedValue({ isHttpError: true, message: 'Network Error', response: undefined });
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c1', accessToken: 'zalo-at' });
    mockedLoginZalo.mockResolvedValue(loginResponse('u4'));

    await useAuthStore.getState().restore();

    expect(mockedRemoveStorage).not.toHaveBeenCalled();
    expect(mockedLoginZalo).not.toHaveBeenCalled();
    expect(mockedLoginGuest).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('error');
    expect(useAuthStore.getState().error).toBe(copy.errors.sessionUnavailable);
  });

  it.each([
    [503, copy.errors.sessionUnavailable],
    [429, copy.errors.sessionRateLimited],
  ])('refresh bị %i khi máy còn token → không gọi loginZaloMiniApp, không loginGuest, status error kèm đúng lý do', async (status, text) => {
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh' });
    mockedRefresh.mockRejectedValue(httpFail(status));
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c1', accessToken: 'zalo-at' });

    await useAuthStore.getState().restore();

    expect(mockedLoginZalo).not.toHaveBeenCalled();
    expect(mockedLoginGuest).not.toHaveBeenCalled();
    expect(mockedRemoveStorage).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('error');
    expect(useAuthStore.getState().error).toBe(text);
  });
});

describe('useAuthStore — mất mạng lúc khôi phục phiên (R5-BUYER-1)', () => {
  function offlineEverything(): void {
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh' });
    mockedRefresh.mockRejectedValue({ isHttpError: true, message: 'Network Error', response: undefined });
    mockedGetZaloAccessToken.mockRejectedValue(new Error('not in zalo'));
    mockedLoginGuest.mockRejectedValue(new Error('Network Error'));
  }

  it('restore() hết cách (refresh, Zalo, khách đều lỗi mạng) → status error kèm câu tiếng Việt, không lộ "Network Error"', async () => {
    offlineEverything();

    await useAuthStore.getState().restore();

    const s = useAuthStore.getState();
    expect(s.status).toBe('error');
    expect(s.error).toBe(copy.errors.sessionUnavailable);
    expect(s.error).not.toMatch(/network/i);
    expect(mockedRemoveStorage).not.toHaveBeenCalled();
  });

  it('login() hết cách → status error kèm câu tiếng Việt, không lộ message thô của trình duyệt', async () => {
    mockedGetZaloAccessToken.mockRejectedValue(new Error('not in zalo'));
    mockedLoginGuest.mockRejectedValue(new Error('timeout of 15000ms exceeded'));

    await useAuthStore.getState().login();

    expect(useAuthStore.getState().status).toBe('error');
    expect(useAuthStore.getState().error).toBe(copy.errors.sessionUnavailable);
  });

  it('có mạng lại rồi restore() lần nữa → vào lại được, xoá câu lỗi cũ', async () => {
    offlineEverything();
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState().status).toBe('error');

    mockedRefresh.mockResolvedValue(loginResponse('u-back'));
    await useAuthStore.getState().restore();

    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.user?.id).toBe('u-back');
    expect(s.error).toBeUndefined();
  });

  it('đã đăng nhập mà làm mới phiên (vd sau khi đặt hàng) gặp lỗi mạng → giữ nguyên phiên, không nháy loading, không rơi sang error', async () => {
    useAuthStore.setState({ user: loginResponse('u-keep').user, status: 'authenticated', error: undefined });
    offlineEverything();
    const seen: string[] = [];
    const unsub = useAuthStore.subscribe((s) => seen.push(s.status));

    await useAuthStore.getState().restore();
    unsub();

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.id).toBe('u-keep');
    expect(seen).not.toContain('loading');
    expect(seen).not.toContain('error');
  });
});

describe('useAuthStore.restore — nâng cấp ngầm phiên khách sang Zalo (A7-01)', () => {
  it('refresh() trả về phiên KHÁCH (zaloId guest_*) → restore() trả về NGAY (không chặn UI) nhưng đã bắt đầu thử nâng cấp NỀN qua ensurePhoneApi (không xin SĐT); nâng cấp xong thì tự chuyển sang danh tính Zalo thật', async () => {
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh' });
    mockedRefresh.mockResolvedValue(loginResponse('guest-1', 'guest_dev1'));
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c1', accessToken: 'zalo-at' });
    let resolveEnsure!: (v: LoginResponse) => void;
    mockedEnsurePhoneApi.mockReturnValue(
      new Promise<LoginResponse>((resolve) => {
        resolveEnsure = resolve;
      }),
    );

    await useAuthStore.getState().restore();

    // restore() không chờ nâng cấp nền — nhưng đã BẮT ĐẦU nó (gọi Zalo silent) trước khi return.
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.id).toBe('guest-1');
    expect(mockedGetZaloAccessToken).toHaveBeenCalledTimes(1);

    await flush();
    expect(mockedEnsurePhoneApi).toHaveBeenCalledWith('c1', 'zalo-at'); // KHÔNG kèm phoneToken — không xin SĐT
    expect(mockedRequestZaloPhoneToken).not.toHaveBeenCalled();

    // Nâng cấp nền xong (thành công) → tự chuyển sang danh tính Zalo thật, không cần mở lại app.
    resolveEnsure(loginResponse('real-1', 'z-real'));
    await flush();
    expect(useAuthStore.getState().user?.id).toBe('real-1');
  });

  it('refresh() trả về phiên ĐÃ LÀ Zalo thật (zaloId không có tiền tố guest_) → KHÔNG thử nâng cấp lại (tránh gọi Zalo thừa mỗi lần mở app)', async () => {
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh' });
    mockedRefresh.mockResolvedValue(loginResponse('u5', 'z-real-5'));

    await useAuthStore.getState().restore();
    await flush();

    expect(mockedGetZaloAccessToken).not.toHaveBeenCalled();
    expect(mockedEnsurePhoneApi).not.toHaveBeenCalled();
  });

  it('nâng cấp ngầm thất bại (Zalo trên máy vẫn chưa khả dụng) → giữ nguyên phiên khách, không lỗi/crash, thử lại ở lần mở app sau', async () => {
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh' });
    mockedRefresh.mockResolvedValue(loginResponse('guest-2', 'guest_dev2'));
    mockedGetZaloAccessToken.mockRejectedValue(new Error('not in zalo'));

    await useAuthStore.getState().restore();
    await flush();

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.id).toBe('guest-2'); // vẫn là khách, không đổi, không sập app
  });
});

describe('useAuthStore.ensurePhone — A7-01: không tự đăng nhập lại từ đầu, dùng endpoint an toàn ensurePhoneApi', () => {
  it('user hiện tại đã có phone → trả về ngay, không gọi Zalo/API nào', async () => {
    useAuthStore.setState({ user: { id: 'u1', phone: '0900000000' } as AuthUser, status: 'authenticated' });

    const phone = await useAuthStore.getState().ensurePhone();

    expect(phone).toBe('0900000000');
    expect(mockedRequestZaloPhoneToken).not.toHaveBeenCalled();
  });

  it('user từ chối chia sẻ SĐT (getPhoneNumber trả null) → trả null, không gọi Zalo login/ensurePhoneApi', async () => {
    useAuthStore.setState({ user: { id: 'guest-1' } as AuthUser, status: 'authenticated' });
    mockedRequestZaloPhoneToken.mockResolvedValue(null);

    const phone = await useAuthStore.getState().ensurePhone();

    expect(phone).toBeNull();
    expect(mockedEnsurePhoneApi).not.toHaveBeenCalled();
  });

  it('gọi ensurePhoneApi() (KHÔNG loginZaloMiniApp — đường login-từ-đầu cũ) — dù BE trả về MỘT USER KHÁC (đã nâng cấp/gộp), FE chỉ tin theo kết quả BE, không tự so sánh/giữ id cũ', async () => {
    useAuthStore.setState({ user: { id: 'guest-1' } as AuthUser, status: 'authenticated' });
    mockedRequestZaloPhoneToken.mockResolvedValue('phone-token');
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c1', accessToken: 'zalo-at' });
    const upgraded = loginResponse('real-1', 'z-real');
    upgraded.user = { ...upgraded.user, phone: '0911111111' };
    mockedEnsurePhoneApi.mockResolvedValue(upgraded);

    const phone = await useAuthStore.getState().ensurePhone();

    expect(mockedLoginZalo).not.toHaveBeenCalled(); // KHÔNG dùng đường login-từ-đầu (A7-01)
    expect(mockedEnsurePhoneApi).toHaveBeenCalledWith('c1', 'zalo-at', 'phone-token');
    expect(useAuthStore.getState().user?.id).toBe('real-1'); // FE chuyển đúng theo quyết định của BE
    expect(phone).toBe('0911111111');
  });

  it('ensurePhoneApi lỗi (mạng/BE từ chối vd ConflictException) → trả null, không crash, không đổi user hiện tại', async () => {
    useAuthStore.setState({ user: { id: 'guest-1' } as AuthUser, status: 'authenticated' });
    mockedRequestZaloPhoneToken.mockResolvedValue('phone-token');
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c1', accessToken: 'zalo-at' });
    mockedEnsurePhoneApi.mockRejectedValue(new Error('network'));

    const phone = await useAuthStore.getState().ensurePhone();

    expect(phone).toBeNull();
    expect(useAuthStore.getState().user?.id).toBe('guest-1');
  });
});

describe.each([
  ['login()', () => useAuthStore.getState().login()],
  ['restore() chưa có phiên', () => useAuthStore.getState().restore()],
])('%s — lỗi tạm của máy chủ không đẩy khách về tài khoản Khách', (_name, run) => {
  beforeEach(() => {
    mockedGetStorage.mockResolvedValue({});
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c', accessToken: 'a' });
  });

  it.each([
    ['503', () => httpFail(503)],
    ['không có response (mạng/timeout)', () => httpFail()],
  ])('zalo-mini-app %s → không loginGuest, status error, câu mất kết nối', async (_label, makeErr) => {
    mockedLoginZalo.mockRejectedValue(makeErr());

    await run();

    expect(mockedLoginGuest).not.toHaveBeenCalled();
    const s = useAuthStore.getState();
    expect(s.status).toBe('error');
    expect(s.error).toBe(copy.errors.sessionUnavailable);
    expect(s.user).toBeNull();
  });

  it('zalo-mini-app 429 (giới hạn tốc độ) → không loginGuest, status error, câu "thao tác quá nhanh" thay cho "mất kết nối"', async () => {
    mockedLoginZalo.mockRejectedValue(httpFail(429, { message: 'ThrottlerException: Too Many Requests' }));

    await run();

    expect(mockedLoginGuest).not.toHaveBeenCalled();
    const s = useAuthStore.getState();
    expect(s.status).toBe('error');
    expect(s.error).toBe(copy.errors.sessionRateLimited);
    expect(s.error).not.toBe(copy.errors.sessionUnavailable);
  });

  it('zalo-mini-app 401 ACCOUNT_BLOCKED → không loginGuest, status idle, error là lời máy chủ, xoá refresh token', async () => {
    mockedLoginZalo.mockRejectedValue(blocked());

    await run();

    expect(mockedLoginGuest).not.toHaveBeenCalled();
    const s = useAuthStore.getState();
    expect(s.status).toBe('idle');
    expect(s.error).toContain('bị khoá');
    expect(mockedRemoveStorage).toHaveBeenCalled();
  });

  it('getZaloAccessToken ném -1401 (app chưa kích hoạt) → vẫn loginGuest', async () => {
    mockedGetZaloAccessToken.mockRejectedValue(Object.assign(new Error('app chua kich hoat'), { code: -1401 }));
    mockedLoginGuest.mockResolvedValue(loginResponse('guest-x'));

    await run();

    expect(mockedLoginZalo).not.toHaveBeenCalled();
    expect(mockedLoginGuest).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('zalo-mini-app 401 khác (Zalo từ chối access token) vẫn rơi xuống khách như trước', async () => {
    mockedLoginZalo.mockRejectedValue(httpFail(401, { message: 'Không xác thực được tài khoản Zalo.' }));
    mockedLoginGuest.mockResolvedValue(loginResponse('guest-y'));

    await run();

    expect(mockedLoginGuest).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });
});

describe('restore() — tài khoản bị khoá lúc có refresh token', () => {
  it('refresh 401 ACCOUNT_BLOCKED → xoá token rồi báo khoá, không loginGuest', async () => {
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored' });
    mockedRefresh.mockRejectedValue(blocked());
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c', accessToken: 'a' });
    mockedLoginZalo.mockRejectedValue(blocked());

    await useAuthStore.getState().restore();

    expect(mockedLoginGuest).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('idle');
    expect(useAuthStore.getState().error).toContain('bị khoá');
  });

  it('đang đăng nhập mà làm mới gặp 503 từ Zalo login → giữ nguyên phiên, không loginGuest', async () => {
    useAuthStore.setState({ user: loginResponse('u-keep', 'z1').user, status: 'authenticated', error: undefined });
    mockedGetStorage.mockResolvedValue({});
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c', accessToken: 'a' });
    mockedLoginZalo.mockRejectedValue(httpFail(503));

    await useAuthStore.getState().restore();

    expect(mockedLoginGuest).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.id).toBe('u-keep');
  });

  it('đang đăng nhập mà tài khoản bị khoá giữa phiên (refresh + Zalo login đều ACCOUNT_BLOCKED) → về idle kèm lời khoá, không giữ user', async () => {
    useAuthStore.setState({ user: loginResponse('u-keep', 'z1').user, status: 'authenticated', error: undefined });
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored' });
    mockedRefresh.mockRejectedValue(blocked());
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c', accessToken: 'a' });
    mockedLoginZalo.mockRejectedValue(blocked());

    await useAuthStore.getState().restore();

    expect(mockedLoginGuest).not.toHaveBeenCalled();
    const s = useAuthStore.getState();
    expect(s.status).toBe('idle');
    expect(s.user).toBeNull();
    expect(s.error).toContain('bị khoá');
    expect(mockedRemoveStorage).toHaveBeenCalled();
  });

  it('đang đăng nhập, ngoài Zalo, tài khoản khách bị khoá giữa phiên (loginGuest ACCOUNT_BLOCKED) → về idle kèm lời khoá', async () => {
    useAuthStore.setState({ user: loginResponse('g-keep').user, status: 'authenticated', error: undefined });
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored' });
    mockedRefresh.mockRejectedValue(blocked());
    mockedGetZaloAccessToken.mockRejectedValue(Object.assign(new Error('not in zalo'), { code: -1401 }));
    mockedLoginGuest.mockRejectedValue(blocked());

    await useAuthStore.getState().restore();

    const s = useAuthStore.getState();
    expect(s.status).toBe('idle');
    expect(s.user).toBeNull();
    expect(s.error).toContain('bị khoá');
  });

  it('tài khoản bị khoá → dọn cache như đăng xuất (điểm, ví đã tải không còn hiện), mọi đường đăng nhập', async () => {
    const cleanup = vi.fn();
    setLogoutCleanup(cleanup);
    mockedGetStorage.mockResolvedValue({});
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c', accessToken: 'a' });
    mockedLoginZalo.mockRejectedValue(blocked());
    await useAuthStore.getState().login();
    expect(cleanup).toHaveBeenCalledTimes(1);

    mockedGetZaloAccessToken.mockRejectedValue(Object.assign(new Error('not in zalo'), { code: -1401 }));
    mockedLoginGuest.mockRejectedValue(blocked());
    await useAuthStore.getState().restore();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});

describe('useAuthStore.ensurePhoneOrThrow — lỗi liên kết Zalo không bị nuốt', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'guest-1', zaloId: 'guest_h_abc' } as AuthUser, status: 'authenticated' });
    mockedRequestZaloPhoneToken.mockResolvedValue('phone-token');
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c1', accessToken: 'zalo-at' });
  });

  it('409 của máy chủ → ném HttpError mang lời máy chủ; ensurePhone() cũ vẫn trả null', async () => {
    const conflict = httpFail(409, { message: 'Số điện thoại này đã gắn với một tài khoản khác.' });
    mockedEnsurePhoneApi.mockRejectedValue(conflict);

    await expect(useAuthStore.getState().ensurePhoneOrThrow()).rejects.toBe(conflict);
    expect(await useAuthStore.getState().ensurePhone()).toBeNull();
    expect(useAuthStore.getState().user?.id).toBe('guest-1');
  });

  it('chưa có phiên (user null, vd đăng nhập vừa bị khoá) → trả null, không mở sheet SĐT, không gọi API', async () => {
    useAuthStore.setState({ user: null, status: 'idle' });

    await expect(useAuthStore.getState().ensurePhoneOrThrow()).resolves.toBeNull();
    expect(mockedRequestZaloPhoneToken).not.toHaveBeenCalled();
    expect(mockedEnsurePhoneApi).not.toHaveBeenCalled();
  });

  it('Zalo không khả dụng (getZaloAccessToken ném -1401) → trả null như khi khách từ chối, không gọi API', async () => {
    mockedGetZaloAccessToken.mockRejectedValue(Object.assign(new Error('app chua kich hoat'), { code: -1401 }));

    await expect(useAuthStore.getState().ensurePhoneOrThrow()).resolves.toBeNull();
    expect(mockedEnsurePhoneApi).not.toHaveBeenCalled();
  });

  it('khách từ chối sheet SĐT → trả null (không ném), không gọi API', async () => {
    mockedRequestZaloPhoneToken.mockResolvedValue(null);

    await expect(useAuthStore.getState().ensurePhoneOrThrow()).resolves.toBeNull();
    expect(mockedEnsurePhoneApi).not.toHaveBeenCalled();
  });

  it('thành công → trả SĐT, đổi user theo máy chủ', async () => {
    const up = loginResponse('real-1', 'z-real');
    up.user = { ...up.user, phone: '0911111111' };
    mockedEnsurePhoneApi.mockResolvedValue(up);

    await expect(useAuthStore.getState().ensurePhoneOrThrow()).resolves.toBe('0911111111');
    expect(useAuthStore.getState().user?.id).toBe('real-1');
  });
});

describe('danh tính đổi trong phiên → làm mới cache cá nhân', () => {
  let qc: QueryClient;
  let invalidate: MockInstance<QueryClient['invalidateQueries']>;
  beforeEach(() => {
    qc = createQueryClient();
    invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
  });

  it('ensurePhone trả user id khác → invalidate đúng 1 lần, bỏ qua khoá danh mục', async () => {
    useAuthStore.setState({ user: { id: 'guest-1' } as AuthUser, status: 'authenticated' });
    mockedRequestZaloPhoneToken.mockResolvedValue('phone-token');
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c1', accessToken: 'zalo-at' });
    const up = loginResponse('real-1', 'z-real');
    up.user = { ...up.user, phone: '0911111111' };
    mockedEnsurePhoneApi.mockResolvedValue(up);

    await useAuthStore.getState().ensurePhone();

    expect(invalidate).toHaveBeenCalledTimes(1);
    const filters = invalidate.mock.calls[0]![0] as unknown as { predicate: (q: { queryKey: unknown[] }) => boolean };
    expect(filters.predicate({ queryKey: ['loyalty'] })).toBe(true);
    expect(filters.predicate({ queryKey: ['game', 'garden'] })).toBe(true);
    expect(filters.predicate({ queryKey: ['products', { page: 1 }] })).toBe(false);
    expect(filters.predicate({ queryKey: ['for-you'] })).toBe(false);
    expect(filters.predicate({ queryKey: ['categories'] })).toBe(false);
    expect(filters.predicate({ queryKey: ['brands'] })).toBe(false);
  });

  it('cùng id và cùng loại tài khoản (làm mới token) → không invalidate', async () => {
    useAuthStore.setState({ user: { id: 'u1', zaloId: 'z1', phone: '0911111111' } as AuthUser, status: 'authenticated' });
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'rt' });
    mockedRefresh.mockResolvedValue(loginResponse('u1', 'z1'));

    await useAuthStore.getState().restore();

    expect(useAuthStore.getState().user?.id).toBe('u1');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('cùng id nhưng khách được nâng lên Zalo tại chỗ → vẫn invalidate (cờ khách của vườn, điểm đổi theo)', async () => {
    useAuthStore.setState({ user: { id: 'guest-1', zaloId: 'guest_h_abc' } as AuthUser, status: 'authenticated' });
    mockedRequestZaloPhoneToken.mockResolvedValue('phone-token');
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c1', accessToken: 'zalo-at' });
    const same = loginResponse('guest-1', 'z-real');
    same.user = { ...same.user, phone: '0911111111' };
    mockedEnsurePhoneApi.mockResolvedValue(same);

    await useAuthStore.getState().ensurePhone();

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('đăng nhập đầu tiên (chưa có user) → không invalidate', async () => {
    mockedGetStorage.mockResolvedValue({});
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c', accessToken: 'a' });
    mockedLoginZalo.mockResolvedValue(loginResponse('u1', 'z1'));

    await useAuthStore.getState().login();

    expect(useAuthStore.getState().user?.id).toBe('u1');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('đăng xuất (user về null) → không invalidate (cache đã được setLogoutCleanup dọn)', async () => {
    useAuthStore.setState({ user: { id: 'u1' } as AuthUser, status: 'authenticated' });

    await useAuthStore.getState().logout();

    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('401 handler đăng ký lúc module load — dùng chung cơ chế refresh dedup', () => {
  it('refresh thành công → trả access token mới, cập nhật user; refresh thất bại (401) → logout về idle, xoá refresh token', async () => {
    const handler = unauthorizedHandler!;
    expect(handler).toBeTypeOf('function');

    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh' });
    mockedRefresh.mockResolvedValue(loginResponse('u3'));
    const token = await handler();
    expect(token).toBe('access-u3');
    expect(useAuthStore.getState().status).toBe('authenticated');

    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh-2' });
    mockedRefresh.mockRejectedValue({ isHttpError: true, response: { status: 401 } });
    const token2 = await handler();
    expect(token2).toBeNull();
    expect(useAuthStore.getState().status).toBe('idle');
    expect(mockedRemoveStorage).toHaveBeenCalled();
  });

  it('refresh thất bại vì mạng/timeout (không có response) → vẫn trả null nhưng KHÔNG xoá refresh token đã lưu', async () => {
    const handler = unauthorizedHandler!;
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh-3' });
    mockedRefresh.mockRejectedValue({ isHttpError: true, message: 'Network Error', response: undefined });

    const token = await handler();

    expect(token).toBeNull();
    expect(mockedRemoveStorage).not.toHaveBeenCalled();
    // 'error' (không phải 'idle') để useSessionRecovery tự thử lại thay vì để khách ở màn mời đăng nhập (D14-04).
    expect(useAuthStore.getState().status).toBe('error');
    expect(useAuthStore.getState().error).toBe(copy.errors.sessionUnavailable);
  });

  it('refresh bị giới hạn tốc độ (429) → error với câu "thao tác quá nhanh", giữ refresh token', async () => {
    const handler = unauthorizedHandler!;
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh-5' });
    mockedRefresh.mockRejectedValue(httpFail(429));

    expect(await handler()).toBeNull();

    expect(useAuthStore.getState().status).toBe('error');
    expect(useAuthStore.getState().error).toBe(copy.errors.sessionRateLimited);
    expect(mockedRemoveStorage).not.toHaveBeenCalled();
  });

  it('refresh bị từ chối (401) → dọn cache như đăng xuất, số liệu của phiên chết không còn hiện', async () => {
    const handler = unauthorizedHandler!;
    const cleanup = vi.fn();
    setLogoutCleanup(cleanup);
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh-6' });
    mockedRefresh.mockRejectedValue(httpFail(401));

    expect(await handler()).toBeNull();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('refresh lỗi 5xx của máy chủ cũng là chưa biết phiên còn hay không → error, giữ refresh token', async () => {
    const handler = unauthorizedHandler!;
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh-4' });
    mockedRefresh.mockRejectedValue({ isHttpError: true, message: 'x', response: { status: 503 } });

    expect(await handler()).toBeNull();

    expect(useAuthStore.getState().status).toBe('error');
    expect(mockedRemoveStorage).not.toHaveBeenCalled();
  });
});

describe('logout() — dọn sạch dữ liệu user cũ trên thiết bị dùng chung', () => {
  it('gọi cleanup đã đăng ký qua setLogoutCleanup (vd queryClient.clear()) sau khi logout', async () => {
    const cleanup = vi.fn();
    setLogoutCleanup(cleanup);
    useAuthStore.setState({ user: { id: 'u1' } as AuthUser, status: 'authenticated' });

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().status).toBe('idle');
    expect(useAuthStore.getState().user).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('thu hồi refresh token đã lưu qua /auth/logout và xoá thông tin hoá đơn trên máy', async () => {
    window.localStorage.setItem('tubu_invoice', JSON.stringify({ taxCode: '0312345678' }));
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-rt' });
    mockedApiPost.mockResolvedValue({ data: undefined, status: 204, headers: {} });
    useAuthStore.setState({ user: { id: 'u1' } as AuthUser, status: 'authenticated' });

    await useAuthStore.getState().logout();
    await flush();

    expect(mockedApiPost).toHaveBeenCalledWith('/auth/logout', { refreshToken: 'stored-rt' });
    expect(window.localStorage.getItem('tubu_invoice')).toBeNull();
    expect(mockedRemoveStorage).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('idle');
  });

  it('API logout lỗi (mất mạng) vẫn đăng xuất trên máy, không ném', async () => {
    window.localStorage.setItem('tubu_invoice', '{}');
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-rt' });
    mockedApiPost.mockRejectedValue(httpFail());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useAuthStore.setState({ user: { id: 'u1' } as AuthUser, status: 'authenticated' });

    await expect(useAuthStore.getState().logout()).resolves.toBeUndefined();
    await flush();

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();

    expect(useAuthStore.getState().status).toBe('idle');
    expect(useAuthStore.getState().user).toBeNull();
    expect(window.localStorage.getItem('tubu_invoice')).toBeNull();
  });

  it('máy không có refresh token → không gọi /auth/logout nhưng vẫn dọn máy', async () => {
    mockedGetStorage.mockResolvedValue({});
    useAuthStore.setState({ user: { id: 'u1' } as AuthUser, status: 'authenticated' });

    await useAuthStore.getState().logout();
    await flush();

    expect(mockedApiPost).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('idle');
  });
});
