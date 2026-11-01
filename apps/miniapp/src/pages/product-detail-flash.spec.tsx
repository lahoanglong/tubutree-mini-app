import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchProduct: vi.fn(), fetchActiveFlashSales: vi.fn(), fetchReviews: vi.fn() }));
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
  fetchReviews: mocks.fetchReviews,
  fetchActiveFlashSales: mocks.fetchActiveFlashSales,
  getCart: vi.fn().mockResolvedValue({ items: [], itemCount: 0 }),
  addToCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: 'guest', login: vi.fn() }) }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: 0.1 }) }));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';
import { syncServerClock } from '../utils/server-clock';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const product = {
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 100_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: 'Mặc định', attributes: {}, retailPrice: 100_000, salePrice: null, stock: 5 }],
};
const flash = (over: Record<string, unknown> = {}) => ({
  itemId: 'f1', productId: 'p1', productSlug: 'xa-phong', productName: 'Xà phòng sả chanh', thumbnail: null, variationId: 'v1',
  retailPrice: 100_000, flashPrice: 80_000, quota: 10, soldCount: 4, endAt: new Date(Date.now() + 2 * 3_600_000).toISOString(), ...over,
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

describe('ProductDetailPage — giờ vàng ở chỗ biên (D7 #12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(product);
    mocks.fetchReviews.mockResolvedValue({ data: [], count: 0, average: 0, items: [] });
  });

  it('còn giờ: thanh Giờ vàng dưới ảnh có "Kết thúc sau …" theo phút và "Đã bán %" (Q3, không "Còn")', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([flash({ endAt: new Date(Date.now() + 2 * 3_600_000 + 30_000).toISOString() })]);
    renderPdp();
    expect(await screen.findByTestId('flash-price-bar')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('Kết thúc sau 2 giờ 00 phút');
    expect(screen.getByText('Đã bán 40%')).toBeInTheDocument();
    expect(screen.queryByText(/^Còn \d+h/)).toBeNull();
  });

  it('Giờ vàng: "Đã bán" nằm cùng dòng với đánh giá, không còn dòng giá trống chỉ để chứa số đã bán', async () => {
    mocks.fetchProduct.mockResolvedValue({ ...product, sold: 1234 });
    mocks.fetchReviews.mockResolvedValue({ data: [], count: 27, average: 4.6, items: [] });
    mocks.fetchActiveFlashSales.mockResolvedValue([flash()]);
    renderPdp();
    await screen.findByTestId('flash-price-bar');
    const sold = screen.getByText(/^Đã bán 1,2k/);
    const rating = screen.getByText(/4,6 · 27 đánh giá/);
    expect(sold.parentElement).toBe(rating.parentElement);
    const h1 = screen.getByRole('heading', { level: 1 });
    // Ngay sau tên là dòng đánh giá (đã gồm "Đã bán"), không có dòng thứ hai trước dòng Điểm Xanh/mô tả.
    expect(h1.nextElementSibling).toBe(sold.parentElement);
  });

  it('Giờ vàng, chưa có đánh giá: "Đã bán" vẫn hiện (một dòng, canh trái); hết Giờ vàng thì về bên phải dòng giá', async () => {
    mocks.fetchProduct.mockResolvedValue({ ...product, sold: 1234 });
    mocks.fetchActiveFlashSales.mockResolvedValue([flash()]);
    const first = renderPdp();
    await screen.findByTestId('flash-price-bar');
    expect(screen.getByText(/^Đã bán 1,2k/).style.marginLeft).toBe('0px');
    first.unmount();
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
    renderPdp();
    await screen.findByText(/^Đã bán 1,2k/);
    expect(screen.queryByTestId('flash-price-bar')).toBeNull();
    expect(screen.getByText(/^Đã bán 1,2k/).style.marginLeft).toBe('auto');
  });

  it('API gửi giới hạn mua: ghi "Mỗi khách tối đa n"; không gửi thì không có dòng', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([flash({ perUserLimit: 3 })]);
    const first = renderPdp();
    expect(await screen.findByText('Mỗi khách tối đa 3')).toBeInTheDocument();
    first.unmount();
    mocks.fetchActiveFlashSales.mockResolvedValue([flash()]);
    renderPdp();
    await screen.findByTestId('flash-price-bar');
    expect(screen.queryByText(/Mỗi khách tối đa/)).toBeNull();
  });

  it('chip phân loại lấy giá qua variationPricing: phân loại có Giờ vàng hiện 84.000đ, không hiện giá niêm yết 120.000đ', async () => {
    mocks.fetchProduct.mockResolvedValue({
      ...product,
      variations: [
        { id: 'v1', sku: 'S1', name: 'Chai 1', attributes: {}, retailPrice: 100_000, salePrice: null, stock: 5 },
        { id: 'v2', sku: 'S2', name: 'Chai 2', attributes: {}, retailPrice: 120_000, salePrice: null, stock: 5 },
      ],
    });
    mocks.fetchActiveFlashSales.mockResolvedValue([flash({ variationId: 'v2', retailPrice: 120_000, flashPrice: 84_000 })]);
    renderPdp();
    const group = await screen.findByRole('group', { name: 'Phân loại nhanh' });
    const [chip1, chip2] = within(group).getAllByRole('button');
    expect(chip1).toHaveTextContent('100.000đ');
    expect(chip2).toHaveTextContent('84.000đ');
    expect(chip2).not.toHaveTextContent('120.000đ');
  });

  it('hết giờ khi khách đang xem: giá, thanh Giờ vàng và giá chip về giá thường, không cần tải lại', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([flash({ endAt: new Date(Date.now() + 1_500).toISOString() })]);
    renderPdp();
    expect((await screen.findAllByText('80.000đ')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('flash-price-bar')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('flash-price-bar')).toBeNull(), { timeout: 4_000 });
    expect(screen.queryAllByText('80.000đ')).toHaveLength(0);
    expect(screen.getAllByText('100.000đ').length).toBeGreaterThan(0);
  });

  it('bán quá suất: thanh chuyển sang "Đã bán hết", không bao giờ in quá 100%', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([flash({ soldCount: 45 })]);
    renderPdp();
    expect(await screen.findByText('Đã bán hết')).toBeInTheDocument();
    expect(screen.queryByText(/Đã bán 1\d\d%/)).toBeNull();
  });

  it('suất đã quá giờ kết thúc (danh sách ở máy cũ): không dùng giá giờ vàng, không nhãn, không đếm ngược', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([flash({ endAt: new Date(Date.now() - 60_000).toISOString() })]);
    renderPdp();
    expect((await screen.findAllByText('100.000đ')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('80.000đ')).toHaveLength(0);
    expect(screen.queryByText('-20%')).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByText(/^Đã bán \d+%$/)).toBeNull();
  });

  describe('điện thoại lệch giờ so với máy chủ', () => {
    afterEach(() => syncServerClock(new Date().toISOString()));

    it('điện thoại nhanh 10 phút, suất còn 5 phút theo máy chủ: vẫn giá giờ vàng', async () => {
      syncServerClock(new Date(Date.now() - 10 * 60_000).toISOString());
      mocks.fetchActiveFlashSales.mockResolvedValue([flash({ endAt: new Date(Date.now() - 5 * 60_000).toISOString() })]);
      renderPdp();
      expect((await screen.findAllByText('80.000đ')).length).toBeGreaterThan(0);
      expect(screen.getByText('-20%')).toBeInTheDocument();
    });

    it('điện thoại chậm 10 phút, suất đã hết 5 phút theo máy chủ: về giá thường', async () => {
      syncServerClock(new Date(Date.now() + 10 * 60_000).toISOString());
      mocks.fetchActiveFlashSales.mockResolvedValue([flash({ endAt: new Date(Date.now() + 5 * 60_000).toISOString() })]);
      renderPdp();
      expect((await screen.findAllByText('100.000đ')).length).toBeGreaterThan(0);
      expect(screen.queryAllByText('80.000đ')).toHaveLength(0);
    });
  });

  it('giờ vàng: giá gạch và % theo giá đang bán trước giờ vàng, khớp dải trang chủ (U1-B05)', async () => {
    mocks.fetchProduct.mockResolvedValue({
      ...product,
      basePrice: 180_000,
      salePrice: 159_000,
      variations: [{ id: 'v1', sku: 'S1', name: 'Mặc định', attributes: {}, retailPrice: 180_000, salePrice: 159_000, stock: 5 }],
    });
    mocks.fetchActiveFlashSales.mockResolvedValue([flash({ retailPrice: 180_000, salePrice: 159_000, flashPrice: 119_000 })]);
    renderPdp();
    expect(await screen.findByText('-25%')).toBeInTheDocument();
    expect(screen.getByText('159.000đ')).toHaveStyle({ textDecoration: 'line-through' });
    expect(screen.queryByText('180.000đ')).toBeNull();
  });
});
