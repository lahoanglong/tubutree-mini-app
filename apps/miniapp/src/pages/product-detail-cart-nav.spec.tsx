import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Nút giỏ ở thanh CTA dính đi qua `useSmartNavigate`: Giỏ → Sản phẩm → bấm giỏ phải lùi về Giỏ cũ, không đẩy Giỏ thứ hai (W163).
const mocks = vi.hoisted(() => ({ fetchProduct: vi.fn(), navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useSnackbar: () => ({ openSnackbar: vi.fn() }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  fetchRelated: vi.fn().mockResolvedValue([]),
  fetchBoughtTogether: vi.fn().mockResolvedValue([]),
  fetchReviews: vi.fn().mockResolvedValue({ data: [], count: 0, average: 0 }),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn().mockResolvedValue({ items: [], itemCount: 0 }),
  addToCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: 'guest', login: vi.fn() }) }));
vi.mock('../components/ui/auth-gate', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useLoginWithNotice: () => vi.fn() }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: 0.1 }) }));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';
import { recordVisit, resetNavTrail } from '../lib/smart-nav';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const product = {
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 75_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: '500ml', attributes: {}, retailPrice: 75_000, salePrice: null, stock: 5 }],
};

/** `idx` đúng như react-router ghi vào `history.state` (MemoryRouter không ghi nên test tự đặt). */
const setIdx = (idx: number) => window.history.replaceState({ idx, key: `k${idx}`, usr: null }, '');

async function clickCart() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/product/xa-phong']} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
  fireEvent.click(within(screen.getByTestId('sticky-bar')).getByRole('button', { name: 'Xem giỏ hàng' }));
}

describe('ProductDetailPage: nút giỏ ở thanh CTA dính (W163)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNavTrail();
    setIdx(0);
    mocks.fetchProduct.mockResolvedValue(product);
  });

  it('Giỏ → Sản phẩm → bấm giỏ: trang ngay trước là /cart và còn lịch sử ⇒ navigate(-1), không đẩy Giỏ thứ hai', async () => {
    setIdx(1);
    recordVisit('/cart');
    setIdx(2);
    await clickCart();
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(-1);
  });

  it('không có vết /cart ở mục trước (đến từ trang khác): đẩy /cart như thường', async () => {
    setIdx(1);
    recordVisit('/browse');
    setIdx(2);
    await clickCart();
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });

  it('mở thẳng trang sản phẩm (idx 0, không có lịch sử): đẩy /cart', async () => {
    await clickCart();
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });
});
