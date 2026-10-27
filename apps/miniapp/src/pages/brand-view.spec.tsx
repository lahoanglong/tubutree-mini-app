import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
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
}));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchActiveFlashSales: mocks.fetchFlash,
}));
vi.mock('../services/dealer-api', () => ({ getDealerMe: mocks.getDealerMe }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'guest' }),
}));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/share-sheet', () => ({
  ShareSheet: ({ visible }: { visible: boolean }) => <div data-testid="share-sheet" data-visible={String(visible)} />,
}));

import BrandViewPage from './brand-view';

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
    mocks.getPublicBrand.mockResolvedValue(BRAND);
    mocks.getBrandShareToEarn.mockResolvedValue({ eligible: false });
    mocks.getBrandFollowState.mockResolvedValue({ following: false, followerCount: 12 });
    mocks.followBrand.mockResolvedValue({ following: true, followerCount: 13 });
    mocks.unfollowBrand.mockResolvedValue({ following: false, followerCount: 12 });
    mocks.getDealerMe.mockResolvedValue({ isDealer: false });
    mocks.copyText.mockResolvedValue(true);
    mocks.fetchFlash.mockResolvedValue([]);
  });

  it('hiện tên nhãn, tagline, số theo dõi và các khối nội dung', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Sachi' })).toBeInTheDocument();
    expect(screen.getByText('Sống xanh mỗi ngày')).toBeInTheDocument();
    expect(screen.getByText('12 người theo dõi')).toBeInTheDocument();
    for (const h of ['Chứng nhận', 'Khuyến mãi', 'Sản phẩm', 'Chương trình đại lý', 'Câu chuyện thương hiệu']) {
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument();
    }
    expect(screen.getByText('Câu chuyện của Sachi')).toBeInTheDocument();
    expect(screen.getByText(/Đạt doanh số 50\.000\.000đ \/ quý/)).toBeInTheDocument();
  });

  it('D15-01: viền khuyến mãi chỉ nhận màu hex, mọi giá trị khác bị bỏ để không chèn được CSS', async () => {
    const promo = (id: string, themeColor: string | null) => ({ ...BRAND.promotions[0]!, id, title: `KM ${id}`, couponCode: null, themeColor });
    mocks.getPublicBrand.mockResolvedValue({
      ...BRAND,
      promotions: [
        promo('hex', '#16a34a'),
        promo('named', 'red'),
        promo('inject', 'red;position:fixed;inset:0;background:url(https://evil.example/x.png)'),
      ],
    });
    renderPage();
    const card = async (id: string) => (await screen.findByText(`KM ${id}`)).parentElement!;
    expect((await card('hex')).style.borderColor).toBe('rgb(22, 163, 74)');
    expect((await card('named')).style.borderColor).not.toBe('red');
    expect((await card('inject')).getAttribute('style') ?? '').not.toMatch(/position|evil|inset/);
  });

  it('Theo dõi gọi followBrand theo slug', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Theo dõi/ }));
    await waitFor(() => expect(mocks.followBrand).toHaveBeenCalledWith('sachi'));
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('đang theo dõi thì bấm lại gọi unfollowBrand', async () => {
    mocks.getBrandFollowState.mockResolvedValue({ following: true, followerCount: 12 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Đang theo dõi/ }));
    await waitFor(() => expect(mocks.unfollowBrand).toHaveBeenCalledWith('sachi'));
  });

  it('chạm mã khuyến mãi chép mã và báo thành công', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sao chép mã TUBU20' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('TUBU20'));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Đã chép mã TUBU20') })),
    );
  });

  it('chép mã thất bại vẫn hiện mã để khách tự nhập', async () => {
    mocks.copyText.mockResolvedValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sao chép mã TUBU20' }));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Mã giảm giá: TUBU20', type: 'info' })),
    );
  });

  it('Giờ vàng: thẻ sản phẩm hiện giá Giờ vàng như Trang chủ và web (B-24)', async () => {
    mocks.fetchFlash.mockResolvedValue([{ itemId: 'i1', variationId: 'v1', productSlug: 'nrc-sachi', productName: 'Nước rửa chén Sachi', thumbnail: null, flashPrice: 60000, retailPrice: 100000, salePrice: 80000, soldCount: 1, quota: 10, endAt: '2099-01-01T00:00:00.000Z' }]);
    renderPage();
    const grid = (await screen.findByRole('heading', { level: 2, name: 'Sản phẩm' })).parentElement!;
    await waitFor(() => expect(within(grid).getByText('60.000đ')).toBeInTheDocument());
    expect(within(grid).getByText('80.000đ')).toBeInTheDocument();
    expect(within(grid).getByText(/Giờ vàng/)).toBeInTheDocument();
    expect(within(grid).queryByText('100.000đ')).toBeNull();
  });

  it('bấm sản phẩm mở trang chi tiết', async () => {
    renderPage();
    const grid = (await screen.findByRole('heading', { level: 2, name: 'Sản phẩm' })).parentElement!;
    fireEvent.click(within(grid).getByText('Nước rửa chén Sachi'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nrc-sachi', undefined);
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

  it('mã khuyến mãi là nút cao ít nhất 44px', async () => {
    renderPage();
    const chip = await screen.findByRole('button', { name: 'Sao chép mã TUBU20' });
    expect(chip.tagName).toBe('BUTTON');
    expect(parseInt(chip.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });

  it('CTV đủ điều kiện nhưng nhãn chưa có tỉ lệ hoa hồng: banner vẫn chia sẻ được, không in "nhận tới % hoa hồng"', async () => {
    for (const rate of [0, null, undefined]) {
      mocks.getBrandShareToEarn.mockResolvedValue({ eligible: true, maxAffiliateRate: rate, referralCode: 'AFF1', brandSlug: 'sachi' });
      const { unmount } = renderPage();
      const banner = await screen.findByRole('button', { name: /Chia sẻ nhãn này/ });
      expect(banner).toHaveTextContent('Chia sẻ nhãn này');
      expect(banner.textContent).not.toMatch(/hoa hồng|nhận tới|%/);
      unmount();
    }
  });

  it('banner share-to-earn là nút thật có thể dùng bàn phím', async () => {
    mocks.getBrandShareToEarn.mockResolvedValue({ eligible: true, maxAffiliateRate: 15, referralCode: 'AFF1', brandSlug: 'sachi' });
    renderPage();
    const banner = await screen.findByRole('button', { name: /Chia sẻ nhãn này — nhận tới 15% hoa hồng/ });
    expect(banner.tagName).toBe('BUTTON');
  });
});

describe('BrandViewPage — hàng chứng nhận cuộn ngang focus được (axe scrollable-region-focusable)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(await screen.findByRole('region', { name: 'Chứng nhận' })).toHaveAttribute('tabindex', '0');
  });
});
