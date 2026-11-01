import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import { PDP_BUNDLES_WAIT_MS } from '../components/product/use-product-bundles';
import ProductDetailPage from './product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const END = '2099-01-01T00:00:00.000Z';
const product = {
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: 'Lên men enzyme dứa.', description: 'Mô tả dài hơn',
  images: [], thumbnail: null, basePrice: 75_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [
    { id: 'v1', sku: 'S1', name: '1L', attributes: {}, retailPrice: 75_000, salePrice: null, stock: 5 },
    { id: 'v2', sku: 'S2', name: 'Can 5L', attributes: {}, retailPrice: 300_000, salePrice: null, stock: 5 },
  ],
};
const card = (id: string) => ({ id, slug: id, brand: 'Cô Lan', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: 65_000, salePrice: null, sold: 0, inStock: true });
const cards = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => card(`${prefix}${i}`));

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

describe('ProductDetailPage — dòng thông tin, đánh giá nhanh, dải gợi ý (P8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(product);
    mocks.fetchRelated.mockResolvedValue([]);
    mocks.fetchBoughtTogether.mockResolvedValue([]);
    mocks.fetchForYou.mockResolvedValue([]);
    mocks.fetchReviews.mockResolvedValue({ count: 0, average: 0, items: [] });
    mocks.getCoupons.mockResolvedValue([]);
    mocks.getProductBundles.mockResolvedValue({ combos: [], addons: [] });
  });

  it('có mã dùng được: dòng "Ưu đãi" ghi số mã, bấm mở hộp thoại "Mã giảm giá"; mã mua chung của SP khác không tính', async () => {
    mocks.getCoupons.mockResolvedValue([
      { code: 'XANH10', type: 'PERCENT', value: 10, minOrder: 250_000, maxDiscount: null, endAt: END, products: null },
      { code: 'FREESHIP', type: 'FREESHIP', value: 0, minOrder: null, maxDiscount: null, endAt: END, products: null },
      { code: 'GBUY-CHIA', type: 'AMOUNT', value: 17_250, minOrder: 63_750, maxDiscount: null, endAt: END, products: [{ id: 'p-chia', name: 'Hạt chia' }] },
    ]);
    renderPdp();
    const row = await screen.findByRole('button', { name: /Ưu đãi/ });
    expect(row).toHaveTextContent('2 mã giảm giá');
    fireEvent.click(row);
    const dialog = await screen.findByRole('dialog', { name: 'Mã giảm giá' });
    expect(within(dialog).getAllByRole('button', { name: 'Sao chép' })).toHaveLength(2);
  });

  it('không có mã dùng được: không có dòng "Ưu đãi"', async () => {
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    expect(screen.queryByRole('button', { name: /Ưu đãi/ })).toBeNull();
  });

  it('nhiều phân loại: dòng "Phân loại ›" ghi phân loại đang chọn và mở bảng chọn', async () => {
    renderPdp();
    const row = await screen.findByRole('button', { name: /^Phân loại/ });
    expect(row).toHaveTextContent('1L');
    fireEvent.click(row);
    expect(await screen.findByRole('group', { name: 'Phân loại' })).toBeInTheDocument();
  });

  it('đánh giá nhanh: 2 đánh giá có chữ, "Xem tất cả (27)" cuộn tới danh sách đầy đủ', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mocks.fetchReviews.mockResolvedValue({
      count: 27, average: 4.4,
      items: [1, 2, 3].map((n) => ({ id: `r${n}`, rating: 5, comment: `Rất tốt ${n}`, images: [], videoUrl: null, createdAt: '2026-10-01T00:00:00.000Z', author: 'Lan' })),
    });
    renderPdp();
    expect(await screen.findAllByTestId('quick-review')).toHaveLength(2);
    // Điểm trung bình kiểu vi-VN ở hàng sao đầu trang (P2 #16): "4,4", không "4.4".
    expect(screen.getByText('4,4 · 27 đánh giá')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả (27)' }));
    expect(scroll).toHaveBeenCalled();
  });

  it('"Khách thường mua cùng" (≥3 món), "Cùng nhà" và "Có thể bạn cũng thích" không trùng nhau và không có món đang xem', async () => {
    mocks.fetchBoughtTogether.mockResolvedValue(cards('b', 3));
    mocks.fetchRelated.mockResolvedValue([...cards('n', 2), card('b0'), card('p1')]);
    mocks.fetchForYou.mockResolvedValue([card('p1'), card('b1'), card('n0'), ...cards('f', 5)]);
    renderPdp();
    expect(await screen.findByRole('heading', { level: 2, name: 'Khách thường mua cùng' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Cùng nhà Cô Lan' })).toBeInTheDocument();
    const alsoLike = await screen.findByRole('heading', { level: 2, name: 'Có thể bạn cũng thích' });
    const feed = alsoLike.closest('section')!;
    expect(within(feed).getAllByRole('button', { name: /Sản phẩm f\d/ })).toHaveLength(5);
    expect(within(feed).queryByText('Sản phẩm b1')).toBeNull();
    expect(within(feed).queryByText('Sản phẩm n0')).toBeNull();
    expect(within(feed).queryByText('Sản phẩm p1')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Thường mua kèm' })).toBeNull();
  });

  it('dải rỗng hoặc lỗi thì ẩn hẳn, không tiêu đề trơ; không có Combo/Mua kèm thì không có khối giữ chỗ', async () => {
    mocks.fetchForYou.mockRejectedValue(new Error('500'));
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    expect(screen.queryByRole('heading', { name: 'Khách thường mua cùng' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Có thể bạn cũng thích' })).toBeNull();
    await waitFor(() => expect(mocks.getProductBundles).toHaveBeenCalledWith('xa-phong'));
    expect(screen.queryByTestId('pdp-bundle-slots')).toBeNull();
  });

  it('có combo và mua kèm: hiện hai khối ngay trên đánh giá, mua kèm ghi điều kiện mua cùng sản phẩm này', async () => {
    const item = (id: string, o: Record<string, unknown> = {}) => ({
      productId: id, variationId: `v-${id}`, maxQty: 1, addonPrice: null, inStock: true,
      product: { ...card(id), repVariationId: `v-${id}`, isFeatured: false }, ...o,
    });
    mocks.getProductBundles.mockResolvedValue({
      combos: [{ id: 'c1', kind: 'BUNDLE_PCT', title: 'Bộ đôi', pct: 10, endAt: END, anchorProductId: null, items: [item('p1'), item('p2')] }],
      addons: [{ id: 'a1', kind: 'ADDON', title: 'Kèm', pct: null, endAt: END, anchorProductId: 'p1', items: [item('p3', { addonPrice: 40_000 })] }],
    });
    renderPdp();
    expect(await screen.findByRole('region', { name: 'Combo ưu đãi' })).toBeInTheDocument();
    const addons = screen.getByRole('region', { name: 'Mua kèm deal sốc' });
    expect(within(addons).getByText('Chỉ khi mua cùng Xà phòng sả chanh')).toBeInTheDocument();
  });

  describe('khung chờ giữ tới khi bộ về (khối nằm giữa màn đầu, chèn sau sẽ đẩy các hàng bên dưới)', () => {
    const item = (id: string) => ({ productId: id, variationId: `v-${id}`, maxQty: 1, addonPrice: null, inStock: true, product: { ...card(id), repVariationId: `v-${id}`, isFeatured: false } });
    const combo = { id: 'c1', kind: 'BUNDLE_PCT', title: 'Bộ đôi', pct: 10, endAt: END, anchorProductId: null, items: [item('p1'), item('p2')] };

    it('bộ về chậm hơn sản phẩm một chút: tiêu đề sản phẩm và khối Combo hiện CÙNG lúc, không có lần vẽ trang mà thiếu khối', async () => {
      mocks.getProductBundles.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ combos: [combo], addons: [] }), 80)));
      renderPdp();
      await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
      expect(screen.getByRole('region', { name: 'Combo ưu đãi' })).toBeInTheDocument();
    });

    it('bộ về rỗng hoặc lỗi: trang hiện ngay khi biết kết quả, không chờ hết hạn chờ', async () => {
      mocks.getProductBundles.mockRejectedValue(new Error('mạng'));
      const started = Date.now();
      renderPdp();
      await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
      expect(Date.now() - started).toBeLessThan(PDP_BUNDLES_WAIT_MS);
      expect(screen.queryByTestId('pdp-bundle-slots')).toBeNull();
    });

    it('API bộ treo: hết hạn chờ thì trang vẫn hiện, không có khối', async () => {
      mocks.getProductBundles.mockReturnValue(new Promise(() => {}));
      renderPdp();
      await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' }, { timeout: 2_000 });
      expect(screen.queryByTestId('pdp-bundle-slots')).toBeNull();
    });
  });

  it('dải gợi ý trả sai dạng (không phải mảng): trang vẫn dựng, chỉ ẩn dải đó', async () => {
    mocks.fetchForYou.mockResolvedValue({ error: 'x' });
    mocks.fetchRelated.mockResolvedValue('lỗi');
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    expect(screen.queryByRole('heading', { name: 'Có thể bạn cũng thích' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Cùng nhà Cô Lan' })).toBeNull();
  });
});
