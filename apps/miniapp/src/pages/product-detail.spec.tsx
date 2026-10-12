import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate as useRouterNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  fetchRelated: vi.fn(),
  fetchBoughtTogether: vi.fn(),
  fetchReviews: vi.fn(),
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

import { RECENTLY_VIEWED_KEY, readRecentlyViewed } from '../utils/recently-viewed';
import ProductDetailPage from './product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const variation = (stock = 5) => ({ id: 'v1', sku: 'SKU1', name: 'Mặc định', attributes: {}, retailPrice: 100000, salePrice: null, stock });
const product = (slug: string, over: Record<string, unknown> = {}) => ({
  id: `id-${slug}`, slug, brand: 'Tubu', name: `Sản phẩm ${slug}`, shortDesc: null, description: 'Mô tả',
  images: ['https://img/1.jpg'], thumbnail: 'https://img/thumb.jpg', basePrice: 100000, salePrice: 80000,
  certifications: [], ingredients: null, sold: 0, variations: [variation()], ...over,
});

function GoTo({ to, label }: { to: string; label: string }) {
  const go = useRouterNavigate();
  return <button type="button" onClick={() => go(to)}>{label}</button>;
}
function renderPdp(slug: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/product/${slug}`]} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
        <GoTo to="/product/b" label="go-b" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const stored = () => JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) ?? '[]') as Array<Record<string, unknown>>;

describe('ProductDetailPage ghi "Đã xem gần đây" (spec 5b.4)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.fetchRelated.mockResolvedValue([]);
    mocks.fetchBoughtTogether.mockResolvedValue([]);
    mocks.fetchReviews.mockResolvedValue({ data: [], summary: { average: 0, count: 0 } });
  });

  it('mở PDP thành công → localStorage có slug/name/thumbnail/giá đang bán', async () => {
    mocks.fetchProduct.mockResolvedValue(product('a'));
    renderPdp('a');
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]).toMatchObject({ slug: 'a', name: 'Sản phẩm a', thumbnail: 'https://img/thumb.jpg', price: 80000 });
  });

  it('SP không có giá sale → ghi giá gốc', async () => {
    mocks.fetchProduct.mockResolvedValue(product('a', { salePrice: null }));
    renderPdp('a');
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]!.price).toBe(100000);
  });

  it('thumbnail null → vẫn ghi (rơi về ảnh đầu); thumbnail undefined + không ảnh → vẫn ghi với null', async () => {
    mocks.fetchProduct.mockResolvedValue(product('a', { thumbnail: null }));
    const first = renderPdp('a');
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]!.thumbnail).toBe('https://img/1.jpg');
    first.unmount();
    localStorage.clear();

    mocks.fetchProduct.mockResolvedValue(product('c', { thumbnail: undefined, images: [] }));
    renderPdp('c');
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]).toMatchObject({ slug: 'c', thumbnail: null });
  });

  it('SP hết hàng vẫn được ghi', async () => {
    mocks.fetchProduct.mockResolvedValue(product('a', { variations: [variation(0)] }));
    renderPdp('a');
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]!.slug).toBe('a');
  });

  it('mở SP khác → SP mới đứng đầu, SP cũ xuống thứ hai', async () => {
    mocks.fetchProduct.mockImplementation((slug: string) => Promise.resolve(product(slug)));
    renderPdp('a');
    await waitFor(() => expect(stored().map((x) => x.slug)).toEqual(['a']));
    await act(async () => screen.getByText('go-b').click());
    await waitFor(() => expect(readRecentlyViewed().map((x) => x.slug)).toEqual(['b', 'a']));
  });

  it('tải lỗi (404/mạng) → không ghi gì', async () => {
    mocks.fetchProduct.mockRejectedValue(new Error('404'));
    renderPdp('zzz');
    // Đợi trang lỗi thật sự hiện ra (query đã settle) rồi mới khẳng định "không ghi" — tránh pass rỗng.
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(localStorage.getItem(RECENTLY_VIEWED_KEY)).toBeNull();
  });
});
