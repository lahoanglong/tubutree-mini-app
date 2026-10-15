import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigate as useRouterNavigate } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chi tiết đơn mở trang sản phẩm kèm state { reviewOrderId } để mở sẵn form đánh giá cho đúng đơn. Form đã mở thì state đó
// phải được gỡ khỏi mục lịch sử: còn giữ thì quay lại trang (hay tải lại) mở lại form, lúc đó đã thành form sửa.

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  seen: [] as (string | undefined)[],
  mounts: 0,
}));
vi.mock('zmp-ui', async (importOriginal) => {
  const rr = await import('react-router-dom');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
    useSnackbar: () => ({ openSnackbar: vi.fn() }),
    useNavigate: rr.useNavigate,
  };
});
vi.mock('../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  fetchRelated: vi.fn().mockResolvedValue([]),
  fetchBoughtTogether: vi.fn().mockResolvedValue([]),
  fetchReviews: vi.fn().mockResolvedValue({ items: [], count: 0, average: 0 }),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn().mockResolvedValue({ items: [] }),
  addToCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: 'authenticated', login: vi.fn() }) }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ data: undefined }) }));
// Khối đánh giá thật mở form khi can-review về rồi báo đã dùng đơn (reviews-section.spec.tsx); ở đây chỉ cần đúng hợp đồng đó.
vi.mock('../components/reviews-section', () => ({
  ReviewsSection: ({ openForOrderId, onOrderLinkUsed }: { openForOrderId?: string; onOrderLinkUsed?: () => void }) => {
    mocks.seen.push(openForOrderId);
    useEffect(() => {
      mocks.mounts += 1;
    }, []);
    useEffect(() => {
      if (openForOrderId) onOrderLinkUsed?.();
    }, [openForOrderId]);
    return <div data-testid="review-link">{openForOrderId ?? 'none'}</div>;
  },
  Stars: () => null,
}));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const product = (slug: string) => ({
  id: `id-${slug}`, slug, brand: 'Tubu', name: `Sản phẩm ${slug}`, shortDesc: null, description: 'Mô tả',
  images: ['https://img/1.jpg'], thumbnail: 'https://img/thumb.jpg', basePrice: 100000, salePrice: 80000,
  certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'SKU1', name: 'Mặc định', attributes: {}, retailPrice: 100000, salePrice: null, stock: 5 }],
});

let current: { pathname: string; state: unknown } = { pathname: '', state: null };
function Probe() {
  const loc = useLocation();
  current = { pathname: loc.pathname, state: loc.state };
  return null;
}
function Nav() {
  const go = useRouterNavigate();
  return (
    <>
      <button type="button" onClick={() => go('/cart')}>go-cart</button>
      <button type="button" onClick={() => go(-1)}>go-back</button>
    </>
  );
}

function renderFromOrder(state: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/order/TB0002', { pathname: '/product/a', state }]} initialIndex={1} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
          <Route path="*" element={<div>trang khác</div>} />
        </Routes>
        <Probe />
        <Nav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductDetailPage: mở form đánh giá từ chi tiết đơn chỉ một lần', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(product('a'));
    mocks.seen = [];
    mocks.mounts = 0;
  });

  it('đã dùng đơn → gỡ reviewOrderId khỏi mục lịch sử hiện tại (giữ các state khác), trang không dựng lại', async () => {
    renderFromOrder({ reviewOrderId: 'o2', from: '/order/TB0002', listSource: 'order' });
    await waitFor(() => expect(screen.getByTestId('review-link')).toHaveTextContent('none'));
    expect(mocks.seen).toContain('o2');
    expect(current).toEqual({ pathname: '/product/a', state: { from: '/order/TB0002', listSource: 'order' } });
    expect(mocks.mounts).toBe(1);
  });

  it('sang trang khác rồi quay lại → mục lịch sử không còn đơn nên không tự mở lại form', async () => {
    renderFromOrder({ reviewOrderId: 'o2' });
    await waitFor(() => expect(screen.getByTestId('review-link')).toHaveTextContent('none'));

    await act(async () => screen.getByText('go-cart').click());
    expect(current.pathname).toBe('/cart');
    mocks.seen = [];
    await act(async () => screen.getByText('go-back').click());

    expect(current.pathname).toBe('/product/a');
    expect(await screen.findByTestId('review-link')).toHaveTextContent('none');
    expect(mocks.seen.length).toBeGreaterThan(0);
    expect(mocks.seen).not.toContain('o2');
  });

  it('không mở từ đơn → không đụng lịch sử', async () => {
    renderFromOrder({ variationId: 'v1' });
    expect(await screen.findByTestId('review-link')).toHaveTextContent('none');
    expect(current.state).toEqual({ variationId: 'v1' });
  });
});
