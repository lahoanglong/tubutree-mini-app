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
// Câu chuyện riêng do admin bật: chỉ khi có cấu hình này trang mới vẽ khối câu chuyện.
const LAYER = { id: 'l', spriteId: 'honey-drop', label: 'Mật', from: 'top', xPct: 50, yPct: 50, scale: 1, rotateDeg: 0 };
const OWN_STORY = {
  version: 1,
  enabled: true,
  scenes: [{ kind: 'ingredient_assembly', steps: [{ title: 'Hái sả', body: 'Sả tươi', layers: [LAYER] }, { title: 'Ép lạnh', body: 'Giữ mùi', layers: [LAYER] }] }],
};

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

  it('có thành phần nhưng chưa có câu chuyện riêng: không vẽ khối câu chuyện dựng sẵn (mục Thành phần đã nói đủ)', async () => {
    mocks.fetchProduct.mockResolvedValue(product({ ingredients: [{ name: 'Sả chanh', percentage: '12%' }] }));
    renderPdp();
    await screen.findByText('Thành phần', { selector: 'h2' });
    expect(screen.queryByTestId('product-story')).toBeNull();
    expect(document.querySelector('[data-pdp-block="story"]')).toBeNull();
  });

  it('có câu chuyện riêng: khối câu chuyện nằm sau mục Thành phần, không có nút "Xem câu chuyện sản phẩm" và không dựng khung toàn màn (dải đã kể đủ các chương)', async () => {
    mocks.fetchProduct.mockResolvedValue(product({ ingredients: [{ name: 'Sả chanh', percentage: '12%' }], storyConfig: OWN_STORY }));
    renderPdp();
    const section = await screen.findByTestId('product-story');
    const heading = screen.getByText('Thành phần', { selector: 'h2' });
    expect(heading.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xem câu chuyện sản phẩm' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Câu chuyện sản phẩm' })).toBeNull();
    expect(section).not.toHaveAttribute('data-fullscreen');
  });

  it('dải trong trang không có nút mua riêng (Thêm vào giỏ / Mua ngay nằm ở thanh dưới), kể cả khi hết hàng', async () => {
    mocks.fetchProduct.mockResolvedValue(
      product({
        ingredients: [{ name: 'Sả chanh', percentage: '12%' }],
        storyConfig: OWN_STORY,
        variations: [{ id: 'v1', sku: 'S1', name: '250g', attributes: {}, retailPrice: 100000, salePrice: null, stock: 0 }],
      }),
    );
    renderPdp();
    const story = await screen.findByTestId('product-story');
    for (const id of ['story-add-to-cart', 'story-buy-now', 'story-close']) expect(within(story).queryByTestId(id), id).toBeNull();
  });

  it('mọi chương hiện cùng lúc dạng thẻ; bấm một thẻ chọn chương đó (aria-current), không có chip/panel/mốc cuộn cũ', async () => {
    mocks.fetchProduct.mockResolvedValue(product({ ingredients: [{ name: 'Sả chanh', percentage: '12%' }], storyConfig: OWN_STORY }));
    renderPdp();
    const story = await screen.findByTestId('product-story');
    const cards = within(story).getAllByTestId('story-step-card');
    expect(cards.length).toBeGreaterThan(1);
    fireEvent.click(cards[cards.length - 1]!);
    expect(within(story).getAllByTestId('story-step-card')[cards.length - 1]).toHaveAttribute('aria-current', 'step');
    for (const id of ['story-step-chip', 'story-step-panel', 'story-static-steps']) expect(within(story).queryByTestId(id), id).toBeNull();
    expect(story.querySelector('.tubu-story-sentinel')).toBeNull();
  });

  it('khối câu chuyện nằm sau ô Số lượng và mục Thành phần, trước Mô tả và Đánh giá; không còn dải "Đánh giá nhanh"', async () => {
    mocks.fetchProduct.mockResolvedValue(product({ ingredients: [{ name: 'Sả chanh', percentage: '12%' }], storyConfig: OWN_STORY }));
    mocks.fetchReviews.mockResolvedValue({ data: [], average: 4.5, count: 2, items: [{ id: 'r1', rating: 5, comment: 'Thơm', images: [], videoUrl: null, author: 'An', createdAt: '2026-11-01T00:00:00.000Z' }] });
    renderPdp();
    const story = await screen.findByTestId('product-story');
    const qty = screen.getByRole('button', { name: /Tăng số lượng/ });
    expect(qty.compareDocumentPosition(story) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const heading = screen.getByText('Thành phần', { selector: 'h2' });
    expect(heading.compareDocumentPosition(story) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const desc = document.querySelector('[data-pdp-block="description"]')!;
    const reviews = document.querySelector('[data-pdp-block="reviews"]')!;
    expect(story.compareDocumentPosition(desc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(story.compareDocumentPosition(reviews) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Đánh giá nhanh' })).toBeNull();
  });
});
