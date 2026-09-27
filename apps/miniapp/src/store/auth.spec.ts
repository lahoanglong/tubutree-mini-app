import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('zmp-sdk/apis', () => ({
  setStorage: vi.fn(),
  getStorage: vi.fn(),
  removeStorage: vi.fn(),
}));
vi.mock('../services/api', () => ({
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

import { getStorage, setStorage, removeStorage } from 'zmp-sdk/apis';
import { loginGuest, loginZaloMiniApp, refreshTokens, setUnauthorizedHandler, ensurePhoneApi } from '../services/api';
import { getZaloAccessToken, requestZaloPhoneToken } from '../services/zmp-bridge';
import type { LoginResponse, AuthUser } from '@tubutree/shared-types';
import { useAuthStore, setLogoutCleanup } from './auth';

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
      coinsBalance: 0,
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
    mockedRefresh.mockRejectedValue({ isAxiosError: true, response: { status: 401 } });
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c1', accessToken: 'zalo-at' });
    mockedLoginZalo.mockResolvedValue(loginResponse('u2'));

    await useAuthStore.getState().restore();

    expect(mockedRemoveStorage).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.id).toBe('u2');
  });

  it('refresh lỗi mạng/timeout (không có response) → KHÔNG xoá refresh token đã lưu, vẫn thử đăng nhập ngầm', async () => {
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh' });
    mockedRefresh.mockRejectedValue({ isAxiosError: true, message: 'Network Error', response: undefined });
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c1', accessToken: 'zalo-at' });
    mockedLoginZalo.mockResolvedValue(loginResponse('u4'));

    await useAuthStore.getState().restore();

    expect(mockedRemoveStorage).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.id).toBe('u4');
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
    mockedRefresh.mockRejectedValue({ isAxiosError: true, response: { status: 401 } });
    const token2 = await handler();
    expect(token2).toBeNull();
    expect(useAuthStore.getState().status).toBe('idle');
    expect(mockedRemoveStorage).toHaveBeenCalled();
  });

  it('refresh thất bại vì mạng/timeout (không có response) → vẫn trả null nhưng KHÔNG xoá refresh token đã lưu', async () => {
    const handler = unauthorizedHandler!;
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh-3' });
    mockedRefresh.mockRejectedValue({ isAxiosError: true, message: 'Network Error', response: undefined });

    const token = await handler();

    expect(token).toBeNull();
    expect(useAuthStore.getState().status).toBe('idle');
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
});
