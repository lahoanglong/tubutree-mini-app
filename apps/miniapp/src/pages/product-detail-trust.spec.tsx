import { render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  returnWindowDays: 7 as unknown,
}));
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
  fetchForYou: vi.fn().mockResolvedValue([]),
  getCart: vi.fn().mockResolvedValue({ items: [], itemCount: 0 }),
  addToCart: vi.fn(),
}));
vi.mock('../services/bundle-api', () => ({ getProductBundles: vi.fn().mockResolvedValue({ combos: [], addons: [] }) }));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: 'idle', login: vi.fn() }) }));
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({ isLoaded: true, freeshipThreshold: 200_000, subscribeDiscountPct: 0.12, returnWindowDays: mocks.returnWindowDays, groupBuy: { discountPct: 15, targetSize: 3 } }),
}));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../components/policy-sheet', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  PolicySheet: ({ slug }: { slug: string | null }) => (slug ? <div data-testid="policy-sheet">{slug}</div> : null),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const product = (over: Record<string, unknown> = {}) => ({
  id: 'p0', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 75_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v0', sku: 'S0', name: 'Mặc định', attributes: {}, retailPrice: 75_000, salePrice: null, stock: 5 }],
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

describe('ProductDetailPage: dải cam kết (W45A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.returnWindowDays = 7;
    mocks.fetchProduct.mockResolvedValue(product());
  });

  it('hàng Tubu giao: dải ba trụ cột đứng sau khối Số lượng và trước khối Cam kết Tubu ở cuối trang', async () => {
    renderPdp();
    const strip = await screen.findByTestId('product-trust-strip');
    expect(within(strip).getAllByRole('listitem')).toHaveLength(3);
    const limit = document.querySelector('[data-section="pdp-flash-limit"]')!;
    const promises = document.getElementById('pdp-promises')!;
    expect(limit).not.toBeNull();
    expect(promises).not.toBeNull();
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(limit, strip)).toBe(true);
    expect(follows(strip, promises)).toBe(true);
  });

  it('chạm lối xem chính sách mở chính sách đổi trả ngay trong trang', async () => {
    renderPdp();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem chính sách đổi trả của Tubu Tree' }));
    expect(screen.getByTestId('policy-sheet')).toHaveTextContent('doi-tra');
  });

  it('nút Vận chuyển của khối Cam kết Tubu vẫn mở chính sách vận chuyển', async () => {
    renderPdp();
    await screen.findByTestId('product-trust-strip');
    fireEvent.click(screen.getByRole('button', { name: 'Chính sách vận chuyển' }));
    expect(screen.getByTestId('policy-sheet')).toHaveTextContent('van-chuyen');
  });

  it('đổi trả tắt (0 ngày): bỏ trụ đổi trả, lối xem chuyển sang chính sách vận chuyển', async () => {
    mocks.returnWindowDays = 0;
    renderPdp();
    const strip = await screen.findByTestId('product-trust-strip');
    expect(within(strip).getAllByRole('listitem')).toHaveLength(2);
    expect(within(strip).queryByTestId('trust-pillar-returns')).toBeNull();
    fireEvent.click(within(strip).getByRole('button', { name: 'Xem chính sách vận chuyển của Tubu Tree' }));
    expect(screen.getByTestId('policy-sheet')).toHaveTextContent('van-chuyen');
  });

  it.each([
    ['gian hàng tự giao', { kind: 'MERCHANT', name: 'Gian Lan', shippingFee: 20_000, freeShipFrom: null }],
    ['gian hàng tạm nghỉ', { kind: 'UNAVAILABLE', name: 'Gian Lan', reason: 'STORE_PAUSED' }],
  ])('%s: không có dải cam kết của Tubu', async (_n, fulfiller) => {
    mocks.fetchProduct.mockResolvedValue(product({ fulfiller }));
    renderPdp();
    await screen.findByText('Xà phòng sả chanh');
    expect(screen.queryByTestId('product-trust-strip')).toBeNull();
  });
});
