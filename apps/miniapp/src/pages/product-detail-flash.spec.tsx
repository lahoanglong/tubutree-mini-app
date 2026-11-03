import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchProduct: vi.fn(), fetchActiveFlashSales: vi.fn(), fetchFlashAllowance: vi.fn(), fetchReviews: vi.fn(), getCart: vi.fn(), addToCart: vi.fn(), navigate: vi.fn(), authStatus: 'guest' }));
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
  fetchReviews: mocks.fetchReviews,
  fetchActiveFlashSales: mocks.fetchActiveFlashSales,
  fetchFlashAllowance: mocks.fetchFlashAllowance,
  getCart: mocks.getCart,
  addToCart: mocks.addToCart,
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
// Có selector thì áp selector (useAuthPhase đọc `s.status`), không thì trả cả store (trang chi tiết destructure).
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: { status: string; login: () => void }) => unknown) => {
    const store = { status: mocks.authStatus, login: vi.fn() };
    return sel ? sel(store) : store;
  },
}));
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
  const tree = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/product/xa-phong']} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree());
  // Vẽ lại cùng cây (cùng QueryClient, cùng state) để trang đọc lại `mocks.authStatus` vừa đổi.
  return { ...view, rerenderPdp: () => view.rerender(tree()) };
}

describe('ProductDetailPage — giờ vàng ở chỗ biên (D7 #12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(product);
    mocks.fetchReviews.mockResolvedValue({ data: [], count: 0, average: 0, items: [] });
    mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
    mocks.fetchFlashAllowance.mockRejectedValue(new Error('404'));
    mocks.authStatus = 'guest';
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

  describe('tiền nút mua theo luật máy chủ khi vượt giới hạn Giờ vàng mỗi khách', () => {
    const buyNow = () => screen.getByRole('button', { name: /^Mua ngay/ });
    const plus = () => screen.getByRole('button', { name: 'Tăng số lượng' });
    const OVER_4 = 'Giá Giờ vàng tối đa 3 sản phẩm mỗi khách. Mua 4 thì cả dòng tính giá thường.';

    it('qty = giới hạn: 3 × 80.000đ; qty 4: cả dòng giá thường 4 × 100.000đ kèm ghi chú dưới ô Số lượng', async () => {
      mocks.fetchActiveFlashSales.mockResolvedValue([flash({ perUserLimit: 3 })]);
      renderPdp();
      await screen.findByTestId('flash-price-bar');
      fireEvent.click(plus());
      fireEvent.click(plus());
      expect(buyNow()).toHaveAccessibleName('Mua ngay · 240.000đ');
      expect(screen.queryByText(OVER_4)).toBeNull();
      fireEvent.click(plus());
      expect(buyNow()).toHaveAccessibleName('Mua ngay · 400.000đ');
      expect(screen.getByText(OVER_4)).toBeInTheDocument();
    });

    it('đợt gần hết suất (còn 2, giới hạn khách 5): qty 3 đã là cả dòng giá thường 300.000đ, ghi chú nói số suất còn và lề ngang 16px như dải Số lượng', async () => {
      mocks.fetchActiveFlashSales.mockResolvedValue([flash({ perUserLimit: 5, quota: 10, soldCount: 8 })]);
      renderPdp();
      await screen.findByTestId('flash-price-bar');
      fireEvent.click(plus());
      expect(buyNow()).toHaveAccessibleName('Mua ngay · 160.000đ');
      fireEvent.click(plus());
      expect(buyNow()).toHaveAccessibleName('Mua ngay · 300.000đ');
      const note = screen.getByText('Giờ vàng còn 2 suất. Mua 3 thì cả dòng tính giá thường.');
      expect(note.style.padding).toContain('var(--space-inset-page)');
    });

    it('API cũ không gửi giới hạn: vẫn qty × giá Giờ vàng, không ghi chú', async () => {
      mocks.fetchActiveFlashSales.mockResolvedValue([flash()]);
      renderPdp();
      await screen.findByTestId('flash-price-bar');
      for (let i = 0; i < 3; i += 1) fireEvent.click(plus());
      expect(buyNow()).toHaveAccessibleName('Mua ngay · 320.000đ');
      expect(screen.queryByText(/cả dòng tính giá thường/)).toBeNull();
    });

    it('hết giờ: nút về qty × giá thường và ghi chú biến mất', async () => {
      mocks.fetchActiveFlashSales.mockResolvedValue([flash({ perUserLimit: 3, endAt: new Date(Date.now() + 1_500).toISOString() })]);
      renderPdp();
      await screen.findByTestId('flash-price-bar');
      for (let i = 0; i < 3; i += 1) fireEvent.click(plus());
      expect(screen.getByText(OVER_4)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByTestId('flash-price-bar')).toBeNull(), { timeout: 4_000 });
      expect(screen.queryByText(OVER_4)).toBeNull();
      expect(buyNow()).toHaveAccessibleName('Mua ngay · 400.000đ');
    });
  });
  describe('giỏ đã có sẵn cùng phân loại: thêm giỏ cộng dồn nên máy chủ giá cả dòng', () => {
    const buyNow = () => screen.getByRole('button', { name: /^Mua ngay/ });
    const plus = () => screen.getByRole('button', { name: 'Tăng số lượng' });
    const cartOf = (quantity: number) => ({
      items: [{ id: 'ci1', variationId: 'v1', slug: 'xa-phong', productName: 'Xà phòng sả chanh', variationName: 'Mặc định', thumbnail: null, unitPrice: 80_000, quantity, stock: 5, weight: 100, total: 80_000 * quantity }],
      itemCount: quantity,
    });
    const IN_CART_2 = 'Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.';
    const MERGE_2 = 'Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.';

    it('giới hạn 3, giỏ có 2: qty 1 (tổng 3) 3 × 80.000đ; qty 2 (tổng 4) cả dòng giá thường 400.000đ kèm ghi chú theo giỏ', async () => {
      mocks.authStatus = 'authenticated';
      mocks.getCart.mockResolvedValue(cartOf(2));
      mocks.fetchActiveFlashSales.mockResolvedValue([flash({ perUserLimit: 3 })]);
      renderPdp();
      await screen.findByTestId('flash-price-bar');
      await waitFor(() => expect(buyNow()).toHaveAccessibleName('Mua ngay · 240.000đ'));
      // Chưa mất giá nhưng nút ghi cả dòng (3 × 80.000đ) cạnh ô Số lượng đang là 1: nói trước khi bấm, không đợi tới thông báo sau khi bấm.
      expect(screen.getByText(MERGE_2)).toBeInTheDocument();
      expect(screen.queryByText(/tính giá thường/)).toBeNull();
      fireEvent.click(plus());
      expect(buyNow()).toHaveAccessibleName('Mua ngay · 400.000đ');
      expect(screen.getByText(IN_CART_2)).toBeInTheDocument();
      expect(screen.queryByText(MERGE_2)).toBeNull();
    });

    it('thêm giỏ thành công rồi nút vẽ lại theo giỏ mới, không đếm số cũ hai lần', async () => {
      mocks.authStatus = 'authenticated';
      mocks.getCart.mockResolvedValue(cartOf(2));
      mocks.addToCart.mockResolvedValue(cartOf(3));
      mocks.fetchActiveFlashSales.mockResolvedValue([flash({ perUserLimit: 3 })]);
      renderPdp();
      await screen.findByTestId('flash-price-bar');
      await waitFor(() => expect(buyNow()).toHaveAccessibleName('Mua ngay · 240.000đ'));
      fireEvent.click(screen.getByRole('button', { name: /^Thêm vào giỏ$/ }));
      await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1));
      // Giỏ giờ có 3 (đúng limit); qty đang chọn vẫn 1 nên thêm tiếp là cả 4 giá thường.
      await waitFor(() => expect(buyNow()).toHaveAccessibleName('Mua ngay · 400.000đ'));
      expect(screen.getByText('Giỏ đã có 3. Thêm 1 thì cả 4 sản phẩm tính giá thường.')).toBeInTheDocument();
    });

    it('Mua ngay: giỏ mới (đã có món vừa thêm) vào cache lúc trang cũ còn mount trong hiệu ứng thoát: số trên nút và câu ghi chú giữ như lúc bấm', async () => {
      mocks.authStatus = 'authenticated';
      mocks.getCart.mockResolvedValue(cartOf(2));
      mocks.addToCart.mockResolvedValue(cartOf(3));
      mocks.fetchActiveFlashSales.mockResolvedValue([flash({ perUserLimit: 3 })]);
      renderPdp();
      await screen.findByTestId('flash-price-bar');
      await waitFor(() => expect(buyNow()).toHaveAccessibleName('Mua ngay · 240.000đ'));
      fireEvent.click(buyNow());
      await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/checkout', expect.anything()));
      // Chờ cho giỏ mới ở cache vẽ lại: trang cũ chưa gỡ nên vẫn thấy số lúc bấm, không nhảy sang 400.000đ.
      await new Promise((r) => setTimeout(r, 20));
      expect(buyNow()).toHaveAccessibleName('Mua ngay · 240.000đ');
      expect(screen.getByText(MERGE_2)).toBeInTheDocument();
      expect(screen.queryByText(/Giỏ đã có 3/)).toBeNull();
    });

    it('Mua ngay lỗi: ở lại trang thì không kẹt số cũ, thêm giỏ lần sau vẽ theo giỏ mới', async () => {
      mocks.authStatus = 'authenticated';
      mocks.getCart.mockResolvedValue(cartOf(2));
      mocks.addToCart.mockRejectedValueOnce(new Error('Hết hàng'));
      mocks.fetchActiveFlashSales.mockResolvedValue([flash({ perUserLimit: 3 })]);
      renderPdp();
      await screen.findByTestId('flash-price-bar');
      await waitFor(() => expect(buyNow()).toHaveAccessibleName('Mua ngay · 240.000đ'));
      fireEvent.click(buyNow());
      await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(1));
      expect(mocks.navigate).not.toHaveBeenCalled();
      mocks.addToCart.mockResolvedValue(cartOf(3));
      await waitFor(() => expect(screen.getByRole('button', { name: /^Thêm vào giỏ$/ })).not.toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: /^Thêm vào giỏ$/ }));
      await waitFor(() => expect(buyNow()).toHaveAccessibleName('Mua ngay · 400.000đ'));
    });

    it('giỏ chưa tải được (lỗi): coi như giỏ rỗng, nút vẫn bấm được và ghi số như khi không có giỏ', async () => {
      mocks.authStatus = 'authenticated';
      mocks.getCart.mockRejectedValue(new Error('mất mạng'));
      mocks.fetchActiveFlashSales.mockResolvedValue([flash({ perUserLimit: 3 })]);
      renderPdp();
      await screen.findByTestId('flash-price-bar');
      expect(buyNow()).toHaveAccessibleName('Mua ngay · 80.000đ');
      expect(buyNow()).not.toBeDisabled();
      expect(screen.queryByText(/Giỏ đã có/)).toBeNull();
    });
  });
});

describe('ProductDetailPage — bảng Mua ngay theo trạng thái đăng nhập (L5 2)', () => {
  const twoVariations = {
    ...product,
    variations: [product.variations[0]!, { id: 'v2', sku: 'S2', name: 'Chai lớn', attributes: {}, retailPrice: 150_000, salePrice: null, stock: 5 }],
  };
  const openBuySheet = async () => {
    renderPdp();
    fireEvent.click(await screen.findByRole('button', { name: /^Mua ngay/ }));
    return screen.findByRole('dialog');
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(twoVariations);
    mocks.fetchReviews.mockResolvedValue({ data: [], count: 0, average: 0, items: [] });
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
    mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
  });

  it('khách chưa đăng nhập (idle): giỏ không bao giờ về nên bảng không giữ dải ghi chú trống', async () => {
    mocks.authStatus = 'idle';
    const dialog = await openBuySheet();
    expect(within(dialog).queryByRole('status')).toBeNull();
  });

  it('đã đăng nhập: bảng giữ chỗ ghi chú từ lúc mở, giỏ về sau chỉ điền chữ', async () => {
    mocks.authStatus = 'authenticated';
    const dialog = await openBuySheet();
    expect(within(dialog).getByRole('status').style.minHeight).not.toBe('');
  });

  it('mở bảng lúc chưa đăng nhập rồi bấm xác nhận (phiên idle sang loading khi bảng còn mở), huỷ đăng nhập (về idle): bảng không hiện rồi ẩn dải trống, chiều cao không đổi', async () => {
    mocks.authStatus = 'idle';
    const view = renderPdp();
    fireEvent.click(await screen.findByRole('button', { name: /^Mua ngay/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('status')).toBeNull();
    mocks.authStatus = 'loading';
    view.rerenderPdp();
    expect(within(screen.getByRole('dialog')).queryByRole('status')).toBeNull();
    mocks.authStatus = 'idle';
    view.rerenderPdp();
    expect(within(screen.getByRole('dialog')).queryByRole('status')).toBeNull();
  });

  it('mở bảng lúc đang khôi phục phiên (loading) rồi ra khách (idle): dải ghi chú đã giữ từ lúc mở không co lại dưới ngón tay', async () => {
    mocks.authStatus = 'loading';
    const view = renderPdp();
    fireEvent.click(await screen.findByRole('button', { name: /^Mua ngay/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('status').style.minHeight).not.toBe('');
    mocks.authStatus = 'idle';
    view.rerenderPdp();
    expect(within(screen.getByRole('dialog')).getByRole('status').style.minHeight).not.toBe('');
  });
});

describe('ProductDetailPage — số suất Giờ vàng khách đã dùng ở các đơn trước (perUserLeft)', () => {
  const buyNow = () => screen.getByRole('button', { name: /^Mua ngay/ });
  const plus = () => screen.getByRole('button', { name: 'Tăng số lượng' });
  const SPENT = 'Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường.';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(product);
    mocks.fetchReviews.mockResolvedValue({ data: [], count: 0, average: 0, items: [] });
    mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
    mocks.fetchActiveFlashSales.mockResolvedValue([flash({ perUserLimit: 3 })]);
    mocks.authStatus = 'authenticated';
  });

  it('đã dùng hết suất (perUserLeft 0): nút ghi giá thường 100.000đ và ghi chú hết suất; một request cho đúng suất của sản phẩm', async () => {
    mocks.fetchFlashAllowance.mockResolvedValue({ items: { f1: { perUserLeft: 0, allowance: 0 } } });
    renderPdp();
    await screen.findByTestId('flash-price-bar');
    await waitFor(() => expect(buyNow()).toHaveAccessibleName('Mua ngay · 100.000đ'));
    expect(screen.getByText(SPENT)).toBeInTheDocument();
    expect(mocks.fetchFlashAllowance).toHaveBeenCalledTimes(1);
    expect(mocks.fetchFlashAllowance).toHaveBeenCalledWith(['f1']);
  });

  it('đổi số lượng nhiều lần không gọi lại endpoint', async () => {
    mocks.fetchFlashAllowance.mockResolvedValue({ items: { f1: { perUserLeft: 0, allowance: 0 } } });
    renderPdp();
    await screen.findByTestId('flash-price-bar');
    await waitFor(() => expect(screen.getByText(SPENT)).toBeInTheDocument());
    fireEvent.click(plus());
    fireEvent.click(plus());
    await waitFor(() => expect(buyNow()).toHaveAccessibleName('Mua ngay · 300.000đ'));
    expect(mocks.fetchFlashAllowance).toHaveBeenCalledTimes(1);
  });

  it('còn 1 suất (đã mua 2 trên giới hạn 3): chọn 1 vẫn giá Giờ vàng, chọn 2 cả dòng giá thường kèm câu "Bạn còn 1 suất"', async () => {
    mocks.fetchFlashAllowance.mockResolvedValue({ items: { f1: { perUserLeft: 1, allowance: 1 } } });
    renderPdp();
    await screen.findByTestId('flash-price-bar');
    await waitFor(() => expect(mocks.fetchFlashAllowance).toHaveBeenCalled());
    await waitFor(() => expect(buyNow()).toHaveAccessibleName('Mua ngay · 80.000đ'));
    expect(screen.queryByText(/Bạn còn 1 suất/)).toBeNull();
    fireEvent.click(plus());
    await waitFor(() => expect(buyNow()).toHaveAccessibleName('Mua ngay · 200.000đ'));
    expect(screen.getByText('Bạn còn 1 suất Giờ vàng. Mua 2 thì cả dòng tính giá thường.')).toBeInTheDocument();
  });

  it('endpoint lỗi (API cũ, mất mạng): số như trước, nút vẫn bấm được', async () => {
    mocks.fetchFlashAllowance.mockRejectedValue(new Error('404'));
    renderPdp();
    await screen.findByTestId('flash-price-bar');
    await waitFor(() => expect(mocks.fetchFlashAllowance).toHaveBeenCalled());
    expect(buyNow()).toHaveAccessibleName('Mua ngay · 80.000đ');
    expect(buyNow()).not.toBeDisabled();
    expect(screen.queryByText(SPENT)).toBeNull();
  });

  it('giữ chỗ ghi chú từ lần vẽ đầu khi đã đăng nhập đang xem Giờ vàng (allowance chưa về); chưa đăng nhập thì không giữ dải trống', async () => {
    mocks.fetchFlashAllowance.mockReturnValue(new Promise(() => {}));
    const view = renderPdp();
    await screen.findByTestId('flash-price-bar');
    const slot = () => document.querySelector<HTMLElement>('[data-section="pdp-flash-limit"]')!;
    expect(slot().style.minHeight).not.toBe('');
    expect(slot().textContent).toBe('');
    view.unmount();
    mocks.authStatus = 'guest';
    renderPdp();
    await screen.findByTestId('flash-price-bar');
    expect(slot().style.minHeight).toBe('');
  });

  it('khách chưa đăng nhập: không gọi endpoint, số như trước', async () => {
    mocks.authStatus = 'guest';
    renderPdp();
    await screen.findByTestId('flash-price-bar');
    expect(buyNow()).toHaveAccessibleName('Mua ngay · 80.000đ');
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.fetchFlashAllowance).not.toHaveBeenCalled();
  });
});
