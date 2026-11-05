import { render, screen, fireEvent, within } from '@testing-library/react';
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
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
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

describe('ProductDetailPage — câu chuyện sản phẩm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRelated.mockResolvedValue([]);
    mocks.fetchBoughtTogether.mockResolvedValue([]);
    mocks.fetchReviews.mockResolvedValue({ data: [], summary: { average: 0, count: 0 } });
  });

  it('không có thành phần và chỉ một phân loại: không nút, không khối câu chuyện', async () => {
    mocks.fetchProduct.mockResolvedValue(product());
    renderPdp();
    await screen.findByText('Cà phê Arabica');
    expect(screen.queryByRole('button', { name: 'Xem câu chuyện sản phẩm' })).toBeNull();
    expect(screen.queryByTestId('product-story')).toBeNull();
  });

  it('có thành phần: khối câu chuyện nằm trước mục Thành phần và nút mở khung toàn màn, Esc đóng', async () => {
    mocks.fetchProduct.mockResolvedValue(product({ ingredients: [{ name: 'Sả chanh', percentage: '12%' }] }));
    renderPdp();
    const section = await screen.findByTestId('product-story');
    const heading = screen.getByText('Thành phần', { selector: 'h2' });
    expect(section.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xem câu chuyện sản phẩm' }));
    const dialog = await screen.findByRole('dialog', { name: 'Câu chuyện sản phẩm' });
    expect(within(dialog).getByTestId('story-buy-now')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
