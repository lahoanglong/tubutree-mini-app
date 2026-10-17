import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchProduct: vi.fn(), fetchActiveFlashSales: vi.fn() }));
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
  fetchActiveFlashSales: mocks.fetchActiveFlashSales,
  getCart: vi.fn().mockResolvedValue({ items: [], itemCount: 0 }),
  addToCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: 'guest', login: vi.fn() }) }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: 0.1 }) }));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const product = {
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 100_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: 'Mặc định', attributes: {}, retailPrice: 100_000, salePrice: null, stock: 5 }],
};
const flash = (over: Record<string, unknown> = {}) => ({
  itemId: 'f1', productId: 'p1', productSlug: 'xa-phong', productName: 'Xà phòng sả chanh', thumbnail: null, variationId: 'v1',
  retailPrice: 100_000, flashPrice: 80_000, quota: 10, soldCount: 4, endAt: new Date(Date.now() + 2 * 3_600_000).toISOString(), ...over,
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

describe('ProductDetailPage — giờ vàng ở chỗ biên (D7 #12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(product);
  });

  it('còn giờ: hiện "Còn Xh YYm" và "Đã bán %"', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([flash()]);
    renderPdp();
    expect(await screen.findByText(/^⏳ Còn 2h 00m$|^Còn 2h 00m$/)).toBeInTheDocument();
    expect(screen.getByText('Đã bán 40%')).toBeInTheDocument();
  });

  it('bán quá suất: kẹp "Đã bán 100%"; quá giờ kết thúc: không hiện "Còn 0h 00m"', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([flash({ soldCount: 40, endAt: new Date(Date.now() - 60_000).toISOString() })]);
    renderPdp();
    expect(await screen.findByText('Đã bán 100%')).toBeInTheDocument();
    expect(screen.queryByText(/Còn \d+h/)).toBeNull();
  });
});
