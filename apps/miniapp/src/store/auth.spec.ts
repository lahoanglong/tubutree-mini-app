import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('zmp-sdk/apis', () => ({
  setStorage: vi.fn(),
  getStorage: vi.fn(),
  removeStorage: vi.fn(),
}));
vi.mock('../services/api', () => ({
  setAccessToken: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  loginGuest: vi.fn(),
  loginZaloMiniApp: vi.fn(),
  refreshTokens: vi.fn(),
}));
vi.mock('../services/zmp-bridge', () => ({
  getZaloAccessToken: vi.fn(),
  requestZaloPhoneToken: vi.fn(),
  getLaunchReferral: vi.fn(() => undefined),
}));

import { getStorage, setStorage, removeStorage } from 'zmp-sdk/apis';
import { loginGuest, loginZaloMiniApp, refreshTokens, setUnauthorizedHandler } from '../services/api';
import { getZaloAccessToken } from '../services/zmp-bridge';
import type { LoginResponse, AuthUser } from '@tubutree/shared-types';
import { useAuthStore } from './auth';

const mockedGetStorage = vi.mocked(getStorage);
const mockedSetStorage = vi.mocked(setStorage);
const mockedRemoveStorage = vi.mocked(removeStorage);
const mockedLoginGuest = vi.mocked(loginGuest);
const mockedLoginZalo = vi.mocked(loginZaloMiniApp);
const mockedRefresh = vi.mocked(refreshTokens);
const mockedSetUnauthorizedHandler = vi.mocked(setUnauthorizedHandler);
const mockedGetZaloAccessToken = vi.mocked(getZaloAccessToken);

// auth.ts đăng ký handler 401 1 LẦN lúc module load (top-level side effect), TRƯỚC
// beforeEach đầu tiên — chụp lại ngay bây giờ, vì vi.clearAllMocks() trong beforeEach
// sẽ xoá sạch lịch sử gọi mock (kể cả lần gọi lúc load module này).
const unauthorizedHandler = mockedSetUnauthorizedHandler.mock.calls[0]?.[0];

function loginResponse(id: string): LoginResponse {
  return {
    accessToken: `access-${id}`,
    refreshToken: `refresh-${id}`,
    user: {
      id,
      role: 'CUSTOMER',
      referralCode: 'REF1',
      pointsBalance: 0,
      walletBalance: 0,
      coinsBalance: 0,
    } as AuthUser,
  };
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

  it('refresh token đã lưu nhưng BE từ chối (hết hạn/đã bị xoay) → xoá refresh cũ rồi thử đăng nhập ngầm', async () => {
    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'expired' });
    mockedRefresh.mockRejectedValue(new Error('refresh token invalid'));
    mockedGetZaloAccessToken.mockResolvedValue({ code: 'c1', accessToken: 'zalo-at' });
    mockedLoginZalo.mockResolvedValue(loginResponse('u2'));

    await useAuthStore.getState().restore();

    expect(mockedRemoveStorage).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.id).toBe('u2');
  });
});

describe('401 handler đăng ký lúc module load — dùng chung cơ chế refresh dedup', () => {
  it('refresh thành công → trả access token mới, cập nhật user; refresh thất bại → logout về idle', async () => {
    const handler = unauthorizedHandler!;
    expect(handler).toBeTypeOf('function');

    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh' });
    mockedRefresh.mockResolvedValue(loginResponse('u3'));
    const token = await handler();
    expect(token).toBe('access-u3');
    expect(useAuthStore.getState().status).toBe('authenticated');

    mockedGetStorage.mockResolvedValue({ tubu_refresh_token: 'stored-refresh-2' });
    mockedRefresh.mockRejectedValue(new Error('invalid'));
    const token2 = await handler();
    expect(token2).toBeNull();
    expect(useAuthStore.getState().status).toBe('idle');
  });
});
