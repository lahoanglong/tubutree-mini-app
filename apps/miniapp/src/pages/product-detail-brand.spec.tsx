import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  fetchProduct: vi.fn(),
  fetchRelated: vi.fn(),
  fetchBoughtTogether: vi.fn(),
  fetchReviews: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useSnackbar: () => ({ openSnackbar: vi.fn() }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  fetchRelated: mocks.fetchRelated,
  fetchBoughtTogether: mocks.fetchBoughtTogether,
  fetchReviews: mocks.fetchReviews,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn(),
  addToCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: 'guest', login: vi.fn() }) }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ data: undefined }) }));
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
  id: 'id-1', slug: 'arabica', brand: 'Le Plateau Coffee', name: 'Cà phê Arabica', shortDesc: null, description: 'Mô tả',
  images: ['https://img/1.jpg'], thumbnail: 'https://img/thumb.jpg', basePrice: 100000, salePrice: 80000,
  certifications: ['USDA Organic'], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: 'Mặc định', attributes: {}, retailPrice: 100000, salePrice: null, stock: 5 }],
  ...over,
});

function renderPdp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/product/arabica']} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductDetailPage — tên nhãn là liên kết (C-079)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(product());
    mocks.fetchRelated.mockResolvedValue([]);
    mocks.fetchBoughtTogether.mockResolvedValue([]);
    mocks.fetchReviews.mockResolvedValue({ data: [], summary: { average: 0, count: 0 } });
  });

  it('bấm tên nhãn mở danh sách lọc theo đúng tên catalog của sản phẩm', async () => {
    renderPdp();
    fireEvent.click(await screen.findByRole('button', { name: 'Le Plateau Coffee' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse?brand=Le%20Plateau%20Coffee');
  });

  it('vùng chạm của tên nhãn cao ít nhất 44px', async () => {
    renderPdp();
    const btn = await screen.findByRole('button', { name: 'Le Plateau Coffee' });
    expect(parseInt(btn.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });

  it('chứng nhận và cam kết dùng icon, không dùng ký tự ✓', async () => {
    renderPdp();
    await screen.findByText('USDA Organic');
    expect(document.body.textContent).not.toContain('✓');
  });
});
