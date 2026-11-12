import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  fetchRelated: vi.fn(),
  fetchBoughtTogether: vi.fn(),
  fetchForYou: vi.fn(),
  fetchReviews: vi.fn(),
  getCoupons: vi.fn(),
  getProductBundles: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useSnackbar: () => ({ openSnackbar: vi.fn() }),
  useNavigate: () => vi.fn(),
}));
vi.mock('../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  fetchRelated: mocks.fetchRelated,
  fetchBoughtTogether: mocks.fetchBoughtTogether,
  fetchForYou: mocks.fetchForYou,
  fetchReviews: mocks.fetchReviews,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn(),
  addToCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getCoupons: mocks.getCoupons }));
vi.mock('../services/bundle-api', () => ({ getProductBundles: mocks.getProductBundles }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: 'authenticated', login: vi.fn() }) }));
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({ isLoaded: true, freeshipThreshold: 200_000, subscribeDiscountPct: 0.12, groupBuy: { discountPct: 15, targetSize: 3 } }),
}));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => <section aria-label="Đánh giá sản phẩm" id="danh-gia" />, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const PINEBOO_SLUG = 'xit-tram-cho-be-pineboo-150ml-b70d1d';
const product = (slug: string, over: Record<string, unknown> = {}) => ({
  id: `id-${slug}`, slug, brand: 'Tubu Tree', name: 'Xịt tràm cho bé Pineboo 150ml', shortDesc: null, description: '',
  images: [], thumbnail: null, basePrice: 75_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: '150ml', attributes: {}, retailPrice: 75_000, salePrice: null, stock: 5 }],
  ...over,
});

function renderPdp(slug: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/product/${slug}`]} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductDetailPage — mô tả và thành phần dự phòng khi PROD trống', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRelated.mockResolvedValue([]);
    mocks.fetchBoughtTogether.mockResolvedValue([]);
    mocks.fetchForYou.mockResolvedValue([]);
    mocks.fetchReviews.mockResolvedValue({ count: 0, average: 0, items: [] });
    mocks.getCoupons.mockResolvedValue([]);
    mocks.getProductBundles.mockResolvedValue({ combos: [], addons: [] });
  });

  it('SKU Pineboo trống mô tả và thành phần: hiện chữ theo bao bì và mục "Thành phần"', async () => {
    mocks.fetchProduct.mockResolvedValue(product(PINEBOO_SLUG));
    renderPdp(PINEBOO_SLUG);
    expect(await screen.findByText(/Bao bì ghi eco-enzyme lên men từ vỏ dứa/)).toBeTruthy();
    expect(screen.getByText('Thành phần')).toBeTruthy();
    expect(screen.getByText('Eco-enzyme lên men từ vỏ dứa')).toBeTruthy();
  });

  it('PROD đã có mô tả và thành phần: giữ nguyên, không chèn chữ dự phòng', async () => {
    mocks.fetchProduct.mockResolvedValue(product(PINEBOO_SLUG, { description: 'Mô tả do shop viết', ingredients: [{ name: 'Dầu tràm', percentage: '5%', benefit: 'Do shop ghi' }] }));
    renderPdp(PINEBOO_SLUG);
    expect(await screen.findByText('Mô tả do shop viết')).toBeTruthy();
    expect(screen.getByText('Dầu tràm')).toBeTruthy();
    expect(screen.getByText('5%')).toBeTruthy();
    expect(screen.queryByText(/Bao bì ghi eco-enzyme/)).toBeNull();
    expect(screen.queryByText('Eco-enzyme lên men từ vỏ dứa')).toBeNull();
  });

  it('slug không có trong bảng: không bịa mô tả hay thành phần, mục "Thành phần" không hiện', async () => {
    mocks.fetchProduct.mockResolvedValue(product('san-pham-la-123abc', { name: 'Sản phẩm lạ' }));
    renderPdp('san-pham-la-123abc');
    await waitFor(() => expect(screen.getAllByText('Sản phẩm lạ').length).toBeGreaterThan(0));
    expect(screen.queryByText('Thành phần')).toBeNull();
    expect(screen.queryByText(/Bao bì ghi/)).toBeNull();
  });
});
