import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  navigate: vi.fn(),
  setCheckoutEntry: vi.fn(),
}));
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
  addToCart: mocks.addToCart,
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn(), setCheckoutEntry: mocks.setCheckoutEntry }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', login: vi.fn(), user: { id: 'u1' } };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, freeshipThreshold: 200_000, subscribeDiscountPct: 0.1 }) }));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';
import { trackEvent } from '../services/analytics';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const PRODUCT = {
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: ['https://img.test/1.jpg', 'https://img.test/2.jpg'], videos: ['https://content.pancake.vn/clip.mp4'], thumbnail: null,
  basePrice: 100_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: 'Mặc định', attributes: {}, retailPrice: 100_000, salePrice: null, stock: 5 }],
};
const CART = { items: [{ id: 'line1', variationId: 'v1', quantity: 1 }], itemCount: 1, couponCode: null, discount: 0 };

function renderPdp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: '/product/xa-phong', state: { listSource: 'home_suggest' } }]} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const events = (name: string) => vi.mocked(trackEvent).mock.calls.filter((c) => c[0] === name).map((c) => c[2]);

describe('ProductDetailPage — sự kiện phễu mua', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(PRODUCT);
    mocks.addToCart.mockResolvedValue(CART);
  });

  it('product_viewed một lần, kèm slug, có video và số ảnh', async () => {
    renderPdp();
    await waitFor(() => expect(events('product_viewed')).toHaveLength(1));
    expect(events('product_viewed')[0]).toEqual({
      productSlug: 'xa-phong',
      hasVideo: true,
      imageCount: 2,
      productId: 'p1',
      variationId: 'v1',
      price: 100_000,
      isFlash: false,
      inStock: true,
      listSource: 'home_suggest',
    });
  });

  it('Thêm vào giỏ chạm đúp: một pdp_action add_to_cart', async () => {
    renderPdp();
    const add = await screen.findByRole('button', { name: 'Thêm vào giỏ' });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(1));
    expect(events('pdp_action')).toEqual([{ action: 'add_to_cart', productSlug: 'xa-phong' }]);
  });

  it('Mua ngay: pdp_action buy_now, ghi dấu nơi vào thanh toán trước khi chuyển trang', async () => {
    renderPdp();
    fireEvent.click(await screen.findByRole('button', { name: /^Mua ngay/ }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/checkout', { state: { itemIds: ['line1'] } }));
    expect(events('pdp_action')).toEqual([{ action: 'buy_now', productSlug: 'xa-phong' }]);
    expect(mocks.setCheckoutEntry).toHaveBeenCalledWith('buy_now');
    const toCheckout = mocks.navigate.mock.calls.findIndex((c) => c[0] === '/checkout');
    expect(mocks.setCheckoutEntry.mock.invocationCallOrder[0]!).toBeLessThan(mocks.navigate.mock.invocationCallOrder[toCheckout]!);
  });

  it('bấm phát video trong thư viện ảnh: pdp_action video_play', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    renderPdp();
    fireEvent.click(await screen.findByTestId('pdp-video-play'));
    expect(events('pdp_action')).toEqual([{ action: 'video_play', productSlug: 'xa-phong' }]);
  });
});
