import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Lối mua trên trang sản phẩm phải đi qua useLoginWithNotice thật (không mock): tài khoản bị khoá bấm mua thì thấy lời máy chủ.
const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  login: vi.fn(),
  openSnackbar: vi.fn(),
  auth: { status: 'idle', error: undefined as string | undefined },
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar }),
  useNavigate: () => vi.fn(),
}));
vi.mock('../store/auth', () => {
  const state = () => ({ status: mocks.auth.status, error: mocks.auth.error, user: null, login: mocks.login });
  return { useAuthStore: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: state }) };
});
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
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), openOAChat: vi.fn(), hasOA: false }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));

import ProductDetailPage from './product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
// Một phân loại: bấm mua đi thẳng tới bước đăng nhập, không mở bảng chọn phân loại.
const product = {
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 75_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: '500ml', attributes: {}, retailPrice: 75_000, salePrice: null, stock: 5 }],
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

describe('ProductDetailPage — tài khoản bị khoá bấm mua', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: 'idle', error: 'Tài khoản đã bị khoá.' };
    mocks.login.mockResolvedValue(undefined);
    mocks.fetchProduct.mockResolvedValue(product);
  });

  it('Thêm vào giỏ: nói lời máy chủ bằng thanh thông báo, không thêm giỏ', async () => {
    renderPdp();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Tài khoản đã bị khoá.', type: 'error' }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('Mua ngay: nói lời máy chủ bằng thanh thông báo, không thêm giỏ', async () => {
    renderPdp();
    fireEvent.click(await screen.findByRole('button', { name: /^Mua ngay/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Tài khoản đã bị khoá.', type: 'error' }));
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('khách đăng xuất bình thường (không có lời máy chủ): mở đăng nhập, không có thanh báo', async () => {
    mocks.auth = { status: 'idle', error: undefined };
    renderPdp();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ' }));
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });
});
