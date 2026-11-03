import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, LoginResponse } from '@tubutree/shared-types';

// Store đăng nhập THẬT: chạm "Lưu mã" lúc app còn đang khôi phục phiên thì chờ phiên rồi lưu mã đó, không đăng nhập song song.
const mocks = vi.hoisted(() => ({ refreshTokens: vi.fn(), loginGuest: vi.fn(), loginZaloMiniApp: vi.fn(), getStorage: vi.fn(), claimCoupon: vi.fn(), notify: vi.fn() }));
vi.mock('zmp-sdk/apis', () => ({ setStorage: vi.fn(async () => undefined), getStorage: mocks.getStorage, removeStorage: vi.fn(async () => undefined) }));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { post: vi.fn(async () => ({})) },
  setAccessToken: vi.fn(),
  setAuthReady: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  refreshTokens: mocks.refreshTokens,
  loginGuest: mocks.loginGuest,
  loginZaloMiniApp: mocks.loginZaloMiniApp,
  ensurePhoneApi: vi.fn(),
}));
vi.mock('../services/first-touch', () => ({ loadFirstTouch: vi.fn(async () => undefined) }));
vi.mock('../services/zmp-bridge', () => ({
  getZaloAccessToken: vi.fn(async () => {
    throw new Error('not in zalo');
  }),
  requestZaloPhoneToken: vi.fn(),
  getLaunchReferral: vi.fn(() => undefined),
}));
vi.mock('../services/coupon-claim', () => ({ claimCoupon: mocks.claimCoupon }));
vi.mock('../services/core-http', () => ({ coreHttp: { get: vi.fn(async () => []) } }));
vi.mock('./use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { useClaimCoupon } from './use-claim-coupon';
import { useAuthStore } from '../store/auth';

const session: LoginResponse = {
  accessToken: 'access-u1',
  refreshToken: 'refresh-u1',
  user: { id: 'u1', zaloId: 'z1', role: 'CUSTOMER', referralCode: 'R', pointsBalance: 0, walletBalance: 0, pointsConvertedBalance: 0 } as AuthUser,
};

describe('useClaimCoupon — chạm lúc app đang khôi phục phiên (store thật)', () => {
  let resolveRefresh!: (v: LoginResponse) => void;
  let rejectRefresh!: (e: unknown) => void;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStorage.mockResolvedValue({ tubu_refresh_token: 'old-refresh' });
    mocks.refreshTokens.mockReturnValue(
      new Promise<LoginResponse>((res, rej) => {
        resolveRefresh = res;
        rejectRefresh = rej;
      }),
    );
    mocks.claimCoupon.mockResolvedValue({ code: 'TUBU30', alreadyClaimed: false });
    useAuthStore.setState({ user: null, status: 'loading', error: undefined });
  });

  function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return renderHook(() => useClaimCoupon(), { wrapper });
  }

  it('khôi phục ra phiên thì mã vừa chạm được lưu một lần, một lần xoay refresh', async () => {
    const { result } = setup();
    const restoring = useAuthStore.getState().restore();
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = result.current.claim('TUBU30');
      second = result.current.claim('TUBU30');
    });
    expect(mocks.claimCoupon).not.toHaveBeenCalled();
    expect(mocks.loginGuest).not.toHaveBeenCalled();
    await act(async () => {
      resolveRefresh(session);
      await restoring;
    });
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(mocks.claimCoupon).toHaveBeenCalledTimes(1);
    expect(mocks.claimCoupon).toHaveBeenCalledWith('TUBU30');
    expect(mocks.refreshTokens).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith({ text: 'Đã lưu vào Mã của tôi', type: 'success' });
  });

  it('khôi phục lỗi mạng: không lưu mã, không báo thành công', async () => {
    const { result } = setup();
    const restoring = useAuthStore.getState().restore();
    let p!: Promise<boolean>;
    await act(async () => {
      p = result.current.claim('TUBU30');
    });
    await act(async () => {
      rejectRefresh({ isHttpError: true, message: 'Network Error', response: undefined });
      await restoring;
    });
    expect(await p).toBe(false);
    expect(mocks.claimCoupon).not.toHaveBeenCalled();
  });
});
