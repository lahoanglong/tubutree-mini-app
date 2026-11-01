import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  authStatus: 'authenticated' as string,
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getPublicBrand: vi.fn(),
  getBrandShareToEarn: vi.fn(),
  getBrandFollowState: vi.fn(),
  followBrand: vi.fn(),
  unfollowBrand: vi.fn(),
  getDealerMe: vi.fn(),
  copyText: vi.fn(),
  fetchFlash: vi.fn(),
  fetchBrandProducts: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useParams: () => ({ slug: 'sachi' }),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
  useLocation: () => ({ pathname: '/brand/sachi', search: '', hash: '', state: null, key: 'k' }),
}));
vi.mock('../services/brand-api', () => ({
  getPublicBrand: mocks.getPublicBrand,
  getBrandShareToEarn: mocks.getBrandShareToEarn,
  getBrandFollowState: mocks.getBrandFollowState,
  followBrand: mocks.followBrand,
  unfollowBrand: mocks.unfollowBrand,
  fetchBrandProducts: mocks.fetchBrandProducts,
}));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchActiveFlashSales: mocks.fetchFlash,
}));
vi.mock('../services/dealer-api', () => ({ getDealerMe: mocks.getDealerMe }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.authStatus }),
}));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/share-sheet', () => ({
  ShareSheet: ({ visible }: { visible: boolean }) => <div data-testid="share-sheet" data-visible={String(visible)} />,
}));

import BrandViewPage from './brand-view';

const openTab = (name: string | RegExp) => fireEvent.click(screen.getByRole('tab', { name }));
const featured = () => within(screen.getByTestId('brand-featured'));

const BRAND = {
  id: 'b1', slug: 'sachi', name: 'Sachi', logoUrl: null, coverUrl: null, tagline: 'Sống xanh mỗi ngày',
  story: 'Câu chuyện của Sachi', storyImages: [], origin: null, isVerified: true, followerCount: 12,
  certifications: [{ code: 'USDA', label: 'USDA Organic', proofUrl: null }],
  promotions: [
    { id: 'p1', title: 'MUA 2 TẶNG 1', subtitle: 'Cuối tuần', themeColor: null, couponCode: 'TUBU20', startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z' },
  ],
  products: [
    { id: 'pr1', name: 'Nước rửa chén Sachi', slug: 'nrc-sachi', thumbnail: null, basePrice: 100000, salePrice: 80000, ratingAvg: 4.5, reviewCount: 3, inStock: true },
  ],
  dealerRewards: [
    { id: 'd1', type: 'GIFT' as const, title: 'Quà quý 3', description: null, threshold: 50_000_000, period: 'QUARTER' },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><BrandViewPage /></QueryClientProvider>);
}

describe('BrandViewPage — nội dung và hành vi giữ nguyên', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getPublicBrand.mockResolvedValue(BRAND);
    mocks.getBrandShareToEarn.mockResolvedValue({ eligible: false });
    mocks.getBrandFollowState.mockResolvedValue({ following: false, followerCount: 12 });
    mocks.followBrand.mockResolvedValue({ following: true, followerCount: 13 });
    mocks.unfollowBrand.mockResolvedValue({ following: false, followerCount: 12 });
    mocks.getDealerMe.mockResolvedValue({ isDealer: false });
    mocks.copyText.mockResolvedValue(true);
    mocks.fetchFlash.mockResolvedValue([]);
  });

  it('hiện tên nhãn, tagline, số theo dõi và các khối của tab Shop', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Sachi' })).toBeInTheDocument();
    expect(screen.getByText('Sống xanh mỗi ngày')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '12 người theo dõi' })).toBeInTheDocument();
    for (const h of ['Chứng nhận', 'Mã giảm giá của shop', 'Câu chuyện thương hiệu', 'Sản phẩm nổi bật', 'Chương trình đại lý']) {
      const heading = screen.getByRole('heading', { level: 2, name: h });
      expect(heading).toBeInTheDocument();
      // Q1: tiêu đề khối là Inter (SectionHeader), không phải Fraunces của tiêu đề trang.
      expect(heading.style.fontFamily).toBe('var(--font-ui)');
    }
    expect(screen.getByText('Câu chuyện của Sachi')).toBeInTheDocument();
    expect(screen.getByText(/Đạt doanh số 50\.000\.000đ \/ quý/)).toBeInTheDocument();
  });

  it('D15-01: màu khuyến mãi từ dữ liệu không còn vào style (không chèn được CSS)', async () => {
    const promo = (id: string, themeColor: string | null) => ({ ...BRAND.promotions[0]!, id, title: `KM ${id}`, couponCode: null, themeColor });
    mocks.getPublicBrand.mockResolvedValue({
      ...BRAND,
      promotions: [promo('hex', '#16a34a'), promo('inject', 'red;position:fixed;inset:0;background:url(https://evil.example/x.png)')],
    });
    renderPage();
    await screen.findByRole('group', { name: 'KM inject' });
    expect(document.body.innerHTML).not.toMatch(/evil\.example|position:\s*fixed;\s*inset/);
  });

  it('Theo dõi gọi followBrand theo slug', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Theo dõi/ }));
    await waitFor(() => expect(mocks.followBrand).toHaveBeenCalledWith('sachi'));
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text: expect.stringContaining('Đã theo dõi thương hiệu') }));
  });

  it('đang theo dõi thì bấm lại gọi unfollowBrand', async () => {
    mocks.getBrandFollowState.mockResolvedValue({ following: true, followerCount: 12 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Đang theo dõi/ }));
    await waitFor(() => expect(mocks.unfollowBrand).toHaveBeenCalledWith('sachi'));
  });

  it('chạm mã khuyến mãi chép mã và báo thành công', async () => {
    renderPage();
    fireEvent.click(within(await screen.findByRole('group', { name: 'MUA 2 TẶNG 1' })).getByRole('button', { name: 'Sao chép' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('TUBU20'));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Đã chép mã TUBU20') })),
    );
  });

  it('chép mã thất bại vẫn hiện mã để khách tự nhập', async () => {
    mocks.copyText.mockResolvedValue(false);
    renderPage();
    fireEvent.click(within(await screen.findByRole('group', { name: 'MUA 2 TẶNG 1' })).getByRole('button', { name: 'Sao chép' }));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Mã giảm giá: TUBU20', type: 'info' })),
    );
  });

  it('kệ "Sản phẩm nổi bật" lùi lề âm 16px bù lề trang, thẻ đầu kệ thẳng với tiêu đề như web (không thụt thêm 16px)', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Sản phẩm nổi bật' });
    const rail = screen.getByTestId('brand-featured-rail');
    expect(rail.className).toContain('tubu-bleed');
    expect(rail.style.margin).toBe('');
    expect(within(rail).getByRole('region', { name: 'Sản phẩm nổi bật' })).toBeInTheDocument();
  });

  it('Giờ vàng: thẻ sản phẩm hiện giá Giờ vàng như Trang chủ và web (B-24)', async () => {
    mocks.fetchFlash.mockResolvedValue([{ itemId: 'i1', variationId: 'v1', productSlug: 'nrc-sachi', productName: 'Nước rửa chén Sachi', thumbnail: null, flashPrice: 60000, retailPrice: 100000, salePrice: 80000, soldCount: 1, quota: 10, endAt: '2099-01-01T00:00:00.000Z' }]);
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Sản phẩm nổi bật' });
    const grid = within(screen.getByTestId('brand-featured'));
    await waitFor(() => expect(grid.getByText('60.000đ')).toBeInTheDocument());
    expect(grid.getByText('80.000đ')).toBeInTheDocument();
    expect(grid.getByText('Giờ vàng -25%')).toBeInTheDocument();
    expect(grid.queryByText('100.000đ')).toBeNull();
  });

  describe('hàng Pancake: giá bán nằm ở phân loại, API trả giá của phân loại mặc định (B-24)', () => {
    const hatDieu = { id: 'pr2', name: 'Hạt điều rang', slug: 'hat-dieu', thumbnail: null, basePrice: 180000, salePrice: 159000, ratingAvg: 4.5, reviewCount: 3, inStock: true };
    const item = (over: Record<string, unknown>) => ({ itemId: 'i2', variationId: 'v1', productSlug: 'hat-dieu', productName: 'Hạt điều rang', thumbnail: null, flashPrice: 119000, retailPrice: 180000, salePrice: 159000, soldCount: 1, quota: 10, endAt: '2099-01-01T00:00:00.000Z', ...over });
    const open = async () => {
      mocks.getPublicBrand.mockResolvedValue({ ...BRAND, products: [hatDieu] });
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'Sản phẩm nổi bật' });
      return screen.getByTestId('brand-featured');
    };

    it('đang bán 159.000đ, Giờ vàng 119.000đ: thẻ gạch 159.000đ, -25%, như trang chi tiết', async () => {
      mocks.fetchFlash.mockResolvedValue([item({})]);
      const grid = await open();
      await waitFor(() => expect(within(grid).getByText('119.000đ')).toBeInTheDocument());
      expect(within(grid).getByText('159.000đ')).toBeInTheDocument();
      expect(within(grid).getByText('Giờ vàng -25%')).toBeInTheDocument();
      expect(within(grid).queryByText('180.000đ')).toBeNull();
    });

    it('hết Giờ vàng: thẻ ghi 159.000đ gạch 180.000đ, không còn ghi 180.000đ làm giá', async () => {
      const grid = await open();
      await waitFor(() => expect(within(grid).getByText('159.000đ')).toBeInTheDocument());
      expect(within(grid).getByText('180.000đ')).toHaveStyle({ textDecoration: 'line-through' });
    });

    it('Giờ vàng ở phân loại thứ hai (niêm yết 300.000đ, Giờ vàng 150.000đ): thẻ như dải Giờ vàng, -50%', async () => {
      mocks.fetchFlash.mockResolvedValue([item({ variationId: 'v2', flashPrice: 150000, retailPrice: 300000, salePrice: null })]);
      const grid = await open();
      await waitFor(() => expect(within(grid).getByText('150.000đ')).toBeInTheDocument());
      expect(within(grid).getByText('300.000đ')).toBeInTheDocument();
      expect(within(grid).getByText('Giờ vàng -50%')).toBeInTheDocument();
      fireEvent.click(within(grid).getByText('Hạt điều rang'));
      expect(mocks.navigate).toHaveBeenCalledWith('/product/hat-dieu', { state: { variationId: 'v2' } });
    });
  });

  it('bấm sản phẩm mở trang chi tiết', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Sản phẩm nổi bật' });
    fireEvent.click(featured().getByText('Nước rửa chén Sachi'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nrc-sachi', undefined);
  });

  it('có xuất xứ và ảnh câu chuyện: hiện cùng khối câu chuyện, nút "Xem trên bản đồ" mở /brand-story', async () => {
    mocks.getPublicBrand.mockResolvedValue({ ...BRAND, slug: 'fuwa3e', name: 'Fuwa3e', origin: 'Lâm Đồng, Việt Nam', storyImages: ['https://img.test/a.jpg', 'https://img.test/b.jpg'] });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fuwa3e' });
    openTab('Câu chuyện');
    expect(await screen.findByText('Xuất xứ: Lâm Đồng, Việt Nam')).toBeInTheDocument();
    const gallery = screen.getByRole('region', { name: 'Ảnh câu chuyện thương hiệu' });
    expect(within(gallery).getAllByRole('img')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Xem trên bản đồ' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/brand-story?brand=fuwa3e');
  });

  it('nhãn chưa có ghim trên bản đồ thì không hiện nút "Xem trên bản đồ"', async () => {
    mocks.getPublicBrand.mockResolvedValue({ ...BRAND, origin: 'Lâm Đồng, Việt Nam' });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Sachi' });
    openTab('Câu chuyện');
    expect(await screen.findByText('Xuất xứ: Lâm Đồng, Việt Nam')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xem trên bản đồ' })).toBeNull();
  });

  it('khối chương trình đại lý dẫn tới /dealer; đại lý đã duyệt chỉ đổi chữ nút', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng ký đại lý' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/dealer');
  });

  it('CTV đủ điều kiện: banner share-to-earn mở sheet chia sẻ', async () => {
    mocks.getBrandShareToEarn.mockResolvedValue({ eligible: true, maxAffiliateRate: 15, referralCode: 'AFF1', brandSlug: 'sachi' });
    renderPage();
    const banner = await screen.findByText(/nhận tới 15% hoa hồng/);
    expect(screen.getByTestId('share-sheet').dataset.visible).toBe('false');
    fireEvent.click(banner);
    expect(screen.getByTestId('share-sheet').dataset.visible).toBe('true');
  });

  it('Chia sẻ mở sheet chia sẻ', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ/ }));
    expect(screen.getByTestId('share-sheet').dataset.visible).toBe('true');
  });
});

describe('BrandViewPage — cấu trúc và vùng chạm (C-076, C-114)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getPublicBrand.mockResolvedValue(BRAND);
    mocks.getBrandShareToEarn.mockResolvedValue({ eligible: false });
    mocks.getBrandFollowState.mockResolvedValue({ following: false, followerCount: 12 });
    mocks.getDealerMe.mockResolvedValue({ isDealer: false });
    mocks.copyText.mockResolvedValue(true);
  });

  it('đúng một h1 khi đang tải', () => {
    mocks.getPublicBrand.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('đúng một h1 khi lỗi tải, có nút Thử lại', async () => {
    mocks.getPublicBrand.mockRejectedValueOnce(new Error('mạng lỗi')).mockResolvedValue(BRAND);
    renderPage();
    const retry = await screen.findByRole('button', { name: /thử lại/i });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    fireEvent.click(retry);
    await screen.findByRole('heading', { level: 1, name: 'Sachi' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('thương hiệu không có (404): báo "Không tìm thấy thương hiệu", nút sang Danh mục, không Thử lại, không hỏi theo dõi/chia sẻ', async () => {
    mocks.getPublicBrand.mockRejectedValue({ isHttpError: true, response: { status: 404 } });
    renderPage();
    expect(await screen.findByText('Không tìm thấy thương hiệu')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /thử lại/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xem Danh mục' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse', { replace: true });
    expect(mocks.getBrandFollowState).not.toHaveBeenCalled();
    expect(mocks.getBrandShareToEarn).not.toHaveBeenCalled();
  });

  it('trang đã tải có đúng một h1 là tên nhãn', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Sachi' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('không dùng ký tự ✓ ↗ + làm icon chức năng (nhãn chính hãng, theo dõi, chia sẻ, chứng nhận)', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Sachi' });
    expect(screen.getByText('Chính hãng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Theo dõi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chia sẻ' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[✓↗]/);
  });

  it('huy hiệu chứng nhận dùng icon thay vì emoji', async () => {
    renderPage();
    const cert = await screen.findByText('USDA Organic');
    expect(cert.textContent).toBe('USDA Organic');
  });

  it('nút Sao chép của phiếu mã là nút thật có vùng chạm 44px', async () => {
    renderPage();
    const btn = within(await screen.findByRole('group', { name: 'MUA 2 TẶNG 1' })).getByRole('button', { name: 'Sao chép' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.className).toContain('tubu-hit-44');
  });

  it('CTV đủ điều kiện nhưng nhãn chưa có tỉ lệ hoa hồng: banner vẫn chia sẻ được, không in "nhận tới % hoa hồng"', async () => {
    for (const rate of [0, null, undefined]) {
      mocks.getBrandShareToEarn.mockResolvedValue({ eligible: true, maxAffiliateRate: rate, referralCode: 'AFF1', brandSlug: 'sachi' });
      const { unmount } = renderPage();
      const banner = await screen.findByRole('button', { name: /Chia sẻ thương hiệu này/ });
      expect(banner).toHaveTextContent('Chia sẻ thương hiệu này');
      expect(banner.textContent).not.toMatch(/hoa hồng|nhận tới|%/);
      unmount();
    }
  });

  it('banner share-to-earn là nút thật có thể dùng bàn phím', async () => {
    mocks.getBrandShareToEarn.mockResolvedValue({ eligible: true, maxAffiliateRate: 15, referralCode: 'AFF1', brandSlug: 'sachi' });
    renderPage();
    const banner = await screen.findByRole('button', { name: /Chia sẻ thương hiệu này — nhận tới 15% hoa hồng/ });
    expect(banner.tagName).toBe('BUTTON');
  });
});

describe('BrandViewPage — hàng chứng nhận cuộn ngang focus được (axe scrollable-region-focusable)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getPublicBrand.mockResolvedValue(BRAND);
    mocks.getBrandShareToEarn.mockResolvedValue({ eligible: false });
    mocks.getBrandFollowState.mockResolvedValue({ following: false, followerCount: 12 });
    mocks.getDealerMe.mockResolvedValue({ isDealer: false });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  });

  it('hàng huy hiệu là vùng .scroll-x có tên "Chứng nhận" chứa huy hiệu', async () => {
    renderPage();
    const region = await screen.findByRole('region', { name: 'Chứng nhận' });
    expect(region.className).toContain('scroll-x');
    expect(within(region).getByText('USDA Organic')).toBeInTheDocument();
  });

  it('huy hiệu không bấm được: hàng tràn ngang thì tự focus được bằng bàn phím', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
    renderPage();
    const region = await screen.findByRole('region', { name: 'Chứng nhận' });
    // tabindex đến từ phép đo sau commit (effect rồi setState), không có sẵn lúc vùng vừa hiện: phải chờ chứ không đọc ngay.
    await waitFor(() => expect(region).toHaveAttribute('tabindex', '0'));
  });
});

describe('BrandViewPage — khung shop (tab, Theo dõi ở đầu, Sản phẩm phân trang thật)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getPublicBrand.mockResolvedValue(BRAND);
    mocks.getBrandShareToEarn.mockResolvedValue({ eligible: false });
    mocks.getBrandFollowState.mockResolvedValue({ following: false, followerCount: 12 });
    mocks.getDealerMe.mockResolvedValue({ isDealer: false });
    mocks.copyText.mockResolvedValue(true);
    mocks.fetchFlash.mockResolvedValue([]);
  });

  it('tab: Shop | Sản phẩm (40) lấy productCount, không phải 30 món đầu; không có tab Danh mục', async () => {
    const products = Array.from({ length: 30 }, (_, i) => ({ ...BRAND.products[0]!, id: `pr${i}`, slug: `sp-${i}`, name: `SP ${i}` }));
    mocks.getPublicBrand.mockResolvedValue({ ...BRAND, products, productCount: 40 });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Sachi' });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Shop', 'Sản phẩm (40)', 'Câu chuyện']);
    expect(screen.getByRole('tab', { name: 'Shop', selected: true })).toBeInTheDocument();
    expect(featured().getAllByRole('button', { name: /^SP \d+$/ })).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Xem tất cả 40 sản phẩm trong Sản phẩm nổi bật' })).toHaveTextContent('Tất cả (40)');
  });

  it('API cũ thiếu productCount: đếm theo danh sách, không "NaN"; không có story/xuất xứ/ảnh thì không có tab Câu chuyện', async () => {
    mocks.getPublicBrand.mockResolvedValue({ ...BRAND, story: null, origin: null, storyImages: [] });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Sachi' });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Shop', 'Sản phẩm (1)']);
    expect(document.body.textContent).not.toContain('NaN');
  });

  it('Theo dõi và Chia sẻ nằm ở đầu shop, không còn thanh dính đáy', async () => {
    renderPage();
    const follow = await screen.findByRole('button', { name: 'Theo dõi' });
    const cover = screen.getByTestId('shop-cover').parentElement!;
    expect(cover.contains(follow)).toBe(true);
    expect(cover.contains(screen.getByRole('button', { name: 'Chia sẻ' }))).toBe(true);
    expect(document.querySelector('[data-testid="sticky-bar"]')).toBeNull();
  });

  it('chưa đăng nhập: bấm Theo dõi báo cần đăng nhập, không hỏi trạng thái theo dõi', async () => {
    mocks.authStatus = 'unauthenticated';
    mocks.followBrand.mockRejectedValue(new Error('401'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Theo dõi' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', text: 'Cần đăng nhập để theo dõi thương hiệu.' })));
    expect(mocks.getBrandFollowState).not.toHaveBeenCalled();
  });

  it('tab Sản phẩm: tải trang 1 của API thương hiệu, "Xem thêm" gọi trang 2, thẻ không in tên thương hiệu', async () => {
    const page = (from: number, count: number) => ({
      data: Array.from({ length: count }, (_, i) => ({ ...BRAND.products[0]!, id: `x${from + i}`, slug: `x-${from + i}`, name: `Hàng ${from + i}`, brand: 'Sachi', isFeatured: false })),
      meta: { page: 1, limit: 20, total: 25 },
    });
    mocks.fetchBrandProducts.mockResolvedValueOnce(page(1, 20)).mockResolvedValueOnce(page(21, 5));
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Sachi' });
    openTab(/^Sản phẩm/);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Hàng \d+$/ })).toHaveLength(20));
    expect(mocks.fetchBrandProducts).toHaveBeenNthCalledWith(1, 'sachi', { page: 1, limit: 20, sort: undefined });
    expect(document.querySelector('[data-ds-part="brand"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    await waitFor(() => expect(mocks.fetchBrandProducts).toHaveBeenNthCalledWith(2, 'sachi', { page: 2, limit: 20, sort: undefined }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Hàng \d+$/ })).toHaveLength(25));
  });

  it('"Đọc câu chuyện" ở tab Shop mở tab Câu chuyện', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đọc câu chuyện' }));
    expect(screen.getByRole('tab', { name: 'Câu chuyện', selected: true })).toBeInTheDocument();
  });
});
