import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchProduct: vi.fn(), getCart: vi.fn(), auth: { status: 'idle' as string } }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useSnackbar: () => ({ openSnackbar: vi.fn() }),
  useNavigate: () => vi.fn(),
}));
vi.mock('../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  fetchRelated: vi.fn().mockResolvedValue([]),
  fetchBoughtTogether: vi.fn().mockResolvedValue([]),
  fetchReviews: vi.fn().mockResolvedValue({ data: [], count: 0, average: 0 }),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: mocks.getCart,
  addToCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: mocks.auth.status, login: vi.fn() }) }));
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({
    isLoaded: true,
    freeshipThreshold: 200_000,
    subscribeDiscountPct: 0.12,
    groupBuy: { discountPct: 15, targetSize: 3 },
  }),
}));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 75_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: 'Mặc định', attributes: {}, retailPrice: 75_000, salePrice: null, stock: 5 }],
  ...over,
});

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

const cartWith = (freeshipThreshold: number) => ({
  items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold, itemCount: 0, unavailableItems: [],
});

describe('ProductDetailPage — dòng freeship theo hạng của khách (R3-UI-9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(product());
    mocks.auth.status = 'idle';
  });

  it('khách chưa đăng nhập: ngưỡng chung của cửa hàng', async () => {
    renderPdp();
    expect(await screen.findByText('Miễn phí vận chuyển cho đơn từ 200.000đ')).toBeInTheDocument();
    expect(mocks.getCart).not.toHaveBeenCalled();
  });

  it('khách hạng có ngưỡng riêng: dùng ngưỡng của giỏ (cùng nguồn với giỏ hàng), không dùng ngưỡng chung', async () => {
    mocks.auth.status = 'authenticated';
    mocks.getCart.mockResolvedValue(cartWith(99_000));
    renderPdp();
    expect(await screen.findByText('Miễn phí vận chuyển cho đơn từ 99.000đ')).toBeInTheDocument();
    expect(screen.queryByText(/200\.000đ/)).toBeNull();
  });

  it('hạng freeship từ 0đ: ghi miễn phí vận chuyển cho mọi đơn, không in "từ 0đ"', async () => {
    mocks.auth.status = 'authenticated';
    mocks.getCart.mockResolvedValue(cartWith(0));
    renderPdp();
    expect(await screen.findByText('Miễn phí vận chuyển cho mọi đơn hàng')).toBeInTheDocument();
    expect(screen.queryByText(/từ 0đ/)).toBeNull();
  });

  it('đã đăng nhập nhưng giỏ chưa về: chưa hiện ngưỡng chung để khỏi hứa sai rồi đổi số', async () => {
    mocks.auth.status = 'authenticated';
    mocks.getCart.mockReturnValue(new Promise(() => undefined));
    renderPdp();
    expect(await screen.findByText('Xà phòng sả chanh')).toBeInTheDocument();
    expect(screen.queryByText(/Miễn phí vận chuyển/)).toBeNull();
  });

  it('đang đăng nhập (status loading): không hiện ngưỡng chung', async () => {
    mocks.auth.status = 'loading';
    renderPdp();
    expect(await screen.findByText('Xà phòng sả chanh')).toBeInTheDocument();
    expect(screen.queryByText(/Miễn phí vận chuyển/)).toBeNull();
  });
});
