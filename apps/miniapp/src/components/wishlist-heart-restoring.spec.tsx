import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { LoginResponse, AuthUser } from '@tubutree/shared-types';

// Store đăng nhập THẬT: chạm tim lúc app còn đang khôi phục phiên không được đăng nhập song song hay xoay refresh token hai lần.
const mocks = vi.hoisted(() => ({ refreshTokens: vi.fn(), loginGuest: vi.fn(), loginZaloMiniApp: vi.fn(), getStorage: vi.fn() }));
const api = vi.hoisted(() => ({ getWishlistIds: vi.fn(), addWishlist: vi.fn(), removeWishlist: vi.fn() }));
vi.mock('zmp-sdk/apis', () => ({ setStorage: vi.fn(async () => undefined), getStorage: mocks.getStorage, removeStorage: vi.fn(async () => undefined) }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useSnackbar: () => ({ openSnackbar: vi.fn() }) }));
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
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../services/wishlist-api', () => api);

import { WishlistHeart } from './wishlist-heart';
import { useAuthStore } from '../store/auth';

const session: LoginResponse = {
  accessToken: 'access-u1',
  refreshToken: 'refresh-u1',
  user: { id: 'u1', zaloId: 'z1', role: 'CUSTOMER', referralCode: 'R', pointsBalance: 0, walletBalance: 0, pointsConvertedBalance: 0 } as AuthUser,
};

describe('WishlistHeart — chạm lúc app đang khôi phục phiên', () => {
  let resolveRefresh!: (v: LoginResponse) => void;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStorage.mockResolvedValue({ tubu_refresh_token: 'old-refresh' });
    mocks.refreshTokens.mockReturnValue(
      new Promise<LoginResponse>((res) => {
        resolveRefresh = res;
      }),
    );
    api.getWishlistIds.mockResolvedValue([]);
    api.addWishlist.mockResolvedValue({ ok: true });
    api.removeWishlist.mockResolvedValue({ ok: true });
    useAuthStore.setState({ user: null, status: 'loading', error: undefined });
  });

  function renderHeart() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <WishlistHeart productId="p1" />
      </QueryClientProvider>,
    );
  }

  it('không đăng nhập song song, một lần xoay refresh; khôi phục ra phiên thì tim được thêm', async () => {
    renderHeart();
    const restoring = useAuthStore.getState().restore();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm yêu thích' }));
    await waitFor(() => expect(mocks.refreshTokens).toHaveBeenCalledTimes(1));
    expect(mocks.loginGuest).not.toHaveBeenCalled();
    expect(mocks.loginZaloMiniApp).not.toHaveBeenCalled();
    expect(api.addWishlist).not.toHaveBeenCalled();

    resolveRefresh(session);
    await restoring;
    await waitFor(() => expect(api.addWishlist).toHaveBeenCalledWith('p1'));
    expect(mocks.refreshTokens).toHaveBeenCalledTimes(1);
    expect(mocks.loginGuest).not.toHaveBeenCalled();
  });

  it('chạm hai lần lúc đang khôi phục: chỉ một lần thêm, không thêm rồi bỏ', async () => {
    renderHeart();
    const restoring = useAuthStore.getState().restore();
    const heart = screen.getByRole('button', { name: 'Thêm yêu thích' });
    fireEvent.click(heart);
    fireEvent.click(heart);
    resolveRefresh(session);
    await restoring;
    await waitFor(() => expect(api.addWishlist).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.removeWishlist).not.toHaveBeenCalled();
  });

  it('login() ném lỗi: cờ chờ được gỡ, lần chạm sau vẫn chạy', async () => {
    const real = useAuthStore.getState().login;
    const failing = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    useAuthStore.setState({ login: failing });
    renderHeart();
    const heart = screen.getByRole('button', { name: 'Thêm yêu thích' });
    fireEvent.click(heart);
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 10));
    fireEvent.click(heart);
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(2));
    useAuthStore.setState({ login: real });
  });
});
