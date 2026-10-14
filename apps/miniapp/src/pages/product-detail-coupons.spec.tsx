import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchProduct: vi.fn(), getCoupons: vi.fn() }));
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
  getCart: vi.fn(),
  addToCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getCoupons: mocks.getCoupons }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: 'authenticated', login: vi.fn() }) }));
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

const END = '2027-01-01T00:00:00.000Z';

describe('ProductDetailPage — mã giảm giá trên trang sản phẩm (R2-BUYERMINI-3)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mã chỉ áp cho sản phẩm khác (mã mua chung) không hiện; mã chung và mã của chính sản phẩm này vẫn hiện', async () => {
    mocks.fetchProduct.mockResolvedValue(product());
    mocks.getCoupons.mockResolvedValue([
      { code: 'XANH10', type: 'PERCENT', value: 10, minOrder: 250_000, maxDiscount: null, endAt: END, products: null },
      { code: 'GBUY-CHIA', type: 'AMOUNT', value: 17_250, minOrder: 63_750, maxDiscount: null, endAt: END, products: [{ id: 'p-chia', name: 'Hạt chia' }] },
      { code: 'GBUY-XP', type: 'AMOUNT', value: 11_250, minOrder: 63_750, maxDiscount: null, endAt: END, products: [{ id: 'p1', name: 'Xà phòng sả chanh' }] },
    ]);
    renderPdp();
    expect(await screen.findByRole('button', { name: 'Sao chép mã XANH10' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sao chép mã GBUY-XP' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sao chép mã GBUY-CHIA' })).toBeNull();
  });
});
