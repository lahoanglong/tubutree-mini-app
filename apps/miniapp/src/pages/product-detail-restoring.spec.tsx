import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoginResponse, AuthUser } from '@tubutree/shared-types';

// Store đăng nhập THẬT: bấm mua lúc app còn đang khôi phục phiên không được đăng nhập song song hay xoay refresh token hai lần,
// và khôi phục ra phiên thì việc vừa bấm chạy tiếp.
const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  refreshTokens: vi.fn(),
  loginGuest: vi.fn(),
  loginZaloMiniApp: vi.fn(),
  getStorage: vi.fn(),
}));
vi.mock('zmp-sdk/apis', () => ({ setStorage: vi.fn(async () => undefined), getStorage: mocks.getStorage, removeStorage: vi.fn(async () => undefined) }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useSnackbar: () => ({ openSnackbar: vi.fn() }),
  useNavigate: () => vi.fn(),
}));
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
vi.mock('../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  fetchRelated: vi.fn().mockResolvedValue([]),
  fetchBoughtTogether: vi.fn().mockResolvedValue([]),
  fetchReviews: vi.fn().mockResolvedValue({ data: [], count: 0, average: 0 }),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn().mockResolvedValue({ items: [], itemCount: 0 }),
  addToCart: mocks.addToCart,
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({
  shareLink: vi.fn(),
  openOAChat: vi.fn(),
  hasOA: false,
  getZaloAccessToken: vi.fn(async () => {
    throw new Error('not in zalo');
  }),
  requestZaloPhoneToken: vi.fn(),
  getLaunchReferral: vi.fn(() => undefined),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));

import ProductDetailPage from './product-detail';
import { useAuthStore } from '../store/auth';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const product = {
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 75_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: '500ml', attributes: {}, retailPrice: 75_000, salePrice: null, stock: 5 }],
};
const session: LoginResponse = {
  accessToken: 'access-u1',
  refreshToken: 'refresh-u1',
  user: { id: 'u1', zaloId: 'z1', role: 'CUSTOMER', referralCode: 'R', pointsBalance: 0, walletBalance: 0, pointsConvertedBalance: 0 } as AuthUser,
};

function renderPdp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/product/xa-phong']} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductDetailPage — bấm mua lúc app đang khôi phục phiên', () => {
  let resolveRefresh!: (v: LoginResponse) => void;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(product);
    mocks.addToCart.mockResolvedValue({ items: [], itemCount: 1 });
    mocks.getStorage.mockResolvedValue({ tubu_refresh_token: 'old-refresh' });
    mocks.refreshTokens.mockReturnValue(
      new Promise<LoginResponse>((res) => {
        resolveRefresh = res;
      }),
    );
    useAuthStore.setState({ user: null, status: 'loading', error: undefined });
  });

  it('không đăng nhập song song, chỉ một lần xoay refresh; khôi phục ra phiên thì thêm vào giỏ chạy tiếp', async () => {
    renderPdp();
    const restoring = useAuthStore.getState().restore();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ' }));
    await waitFor(() => expect(mocks.refreshTokens).toHaveBeenCalledTimes(1));
    expect(mocks.loginGuest).not.toHaveBeenCalled();
    expect(mocks.loginZaloMiniApp).not.toHaveBeenCalled();
    expect(mocks.addToCart).not.toHaveBeenCalled();

    resolveRefresh(session);
    await restoring;
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(1));
    expect(mocks.refreshTokens).toHaveBeenCalledTimes(1);
    expect(mocks.loginGuest).not.toHaveBeenCalled();
  });
});
