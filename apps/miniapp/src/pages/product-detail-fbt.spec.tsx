import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  fetchBoughtTogether: vi.fn(),
  fetchFlash: vi.fn(),
  getCart: vi.fn(),
  getBundles: vi.fn(),
  auth: { status: 'idle' as string },
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
  fetchBoughtTogether: mocks.fetchBoughtTogether,
  fetchReviews: vi.fn().mockResolvedValue({ data: [], count: 0, average: 0 }),
  fetchActiveFlashSales: mocks.fetchFlash,
  fetchForYou: vi.fn().mockResolvedValue([]),
  getCart: mocks.getCart,
  addToCart: vi.fn(),
}));
vi.mock('../services/bundle-api', () => ({ getProductBundles: mocks.getBundles }));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: mocks.auth.status, login: vi.fn() }) }));
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({ isLoaded: true, freeshipThreshold: 200_000, subscribeDiscountPct: 0.12, groupBuy: { discountPct: 15, targetSize: 3 } }),
}));
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
  id: 'p0', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 75_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v0', sku: 'S0', name: 'Mặc định', attributes: {}, retailPrice: 75_000, salePrice: null, stock: 5 }],
  ...over,
});
const card = (n: number, over: Record<string, unknown> = {}) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Món ${n}`, thumbnail: null, basePrice: 50_000, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v${n}`, ...over,
});
const CARDS = [1, 2, 3, 4, 5].map((n) => card(n));

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
const railNames = () => {
  const rail = screen.queryByRole('region', { name: 'Khách thường mua cùng' });
  return rail ? Array.from(rail.querySelectorAll('.tubu-tile-link')).map((a) => a.textContent ?? '') : [];
};

describe('ProductDetailPage: Gợi ý mua kèm hợp vị (W43A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.status = 'idle';
    mocks.fetchProduct.mockResolvedValue(product());
    mocks.fetchBoughtTogether.mockResolvedValue(CARDS);
    mocks.fetchFlash.mockResolvedValue([]);
    mocks.getBundles.mockResolvedValue({ combos: [], addons: [] });
    mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
  });

  it('món đang xem + 2 món đầu của "Khách thường mua cùng", chọn hết, tổng đúng giá trang ghi', async () => {
    renderPdp();
    const fbt = await screen.findByTestId('fbt');
    const rows = within(fbt).getAllByTestId('fbt-row');
    expect(rows.map((r) => r.getAttribute('data-variation-id'))).toEqual(['v0', 'v1', 'v2']);
    expect(within(rows[0]!).getByText('Món đang xem')).toBeInTheDocument();
    expect(within(fbt).getByTestId('fbt-add')).toHaveTextContent('Thêm 3 món vào giỏ · 175.000đ');
  });

  it('hai món bổ trợ chiếm chỗ của dải "Khách thường mua cùng": dải chỉ còn các món sau (đủ sàn 3 món)', async () => {
    mocks.fetchBoughtTogether.mockResolvedValue([1, 2, 3, 4, 5].map((n) => card(n)));
    renderPdp();
    await screen.findByTestId('fbt');
    await waitFor(() => expect(railNames().length).toBeGreaterThan(0));
    const names = railNames().join('|');
    expect(names).toContain('Món 3');
    expect(names).toContain('Món 5');
    expect(names).not.toContain('Món 1');
    expect(names).not.toContain('Món 2');
  });

  it('dải bên dưới rơi dưới sàn 3 món sau khi bỏ 2 món của khối: dải ẩn, khối vẫn hiện', async () => {
    mocks.fetchBoughtTogether.mockResolvedValue([1, 2, 3, 4].map((n) => card(n)));
    renderPdp();
    await screen.findByTestId('fbt');
    expect(screen.queryByRole('region', { name: 'Khách thường mua cùng' })).toBeNull();
  });

  it('không có gợi ý nào: khối không hiện', async () => {
    mocks.fetchBoughtTogether.mockResolvedValue([]);
    renderPdp();
    await screen.findByText('Xà phòng sả chanh');
    await waitFor(() => expect(mocks.fetchBoughtTogether).toHaveBeenCalled());
    expect(screen.queryByTestId('fbt')).toBeNull();
  });

  it('món đang xem hết hàng: khối không hiện và dải "Khách thường mua cùng" giữ đủ món (khối không chiếm món nào)', async () => {
    mocks.fetchProduct.mockResolvedValue(product({ variations: [{ id: 'v0', sku: 'S0', name: 'Mặc định', attributes: {}, retailPrice: 75_000, salePrice: null, stock: 0 }] }));
    renderPdp();
    await screen.findByText('Xà phòng sả chanh');
    await waitFor(() => expect(railNames().length).toBeGreaterThan(0));
    expect(screen.queryByTestId('fbt')).toBeNull();
    const names = railNames().join('|');
    expect(names).toContain('Món 1');
    expect(names).toContain('Món 2');
  });

  it('bỏ món hết hàng và món đã có trong giỏ khỏi gợi ý (khách đã đăng nhập, giỏ về trước khi chọn)', async () => {
    mocks.auth.status = 'authenticated';
    mocks.getCart.mockResolvedValue({ items: [{ id: 'l1', variationId: 'v-x', productId: 'p1', quantity: 1 }], itemCount: 1 });
    mocks.fetchBoughtTogether.mockResolvedValue([card(1), card(2, { inStock: false }), card(3), card(4)]);
    renderPdp();
    const fbt = await screen.findByTestId('fbt');
    expect(within(fbt).getAllByTestId('fbt-row').map((r) => r.getAttribute('data-variation-id'))).toEqual(['v0', 'v3', 'v4']);
  });

  it('khách đã đăng nhập, giỏ chưa về: chưa hiện khối và chưa lấy món nào khỏi dải; giỏ về thì hiện một lần', async () => {
    mocks.auth.status = 'authenticated';
    let release: (v: unknown) => void = () => {};
    mocks.getCart.mockImplementation(() => new Promise((r) => { release = r; }));
    renderPdp();
    await screen.findByText('Xà phòng sả chanh');
    await waitFor(() => expect(mocks.fetchBoughtTogether).toHaveBeenCalled());
    expect(screen.queryByTestId('fbt')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Khách thường mua cùng' })).toBeNull();
    release({ items: [], itemCount: 0 });
    expect(await screen.findByTestId('fbt')).toBeInTheDocument();
  });

  it('giỏ lỗi: vẫn hiện khối (coi như giỏ rỗng), không treo trang', async () => {
    mocks.auth.status = 'authenticated';
    mocks.getCart.mockRejectedValue(new Error('boom'));
    renderPdp();
    expect(await screen.findByTestId('fbt')).toBeInTheDocument();
  });

  it('Giờ vàng đang chạy của món bổ trợ: dòng ghi giá Giờ vàng và thêm phân loại của suất', async () => {
    mocks.fetchFlash.mockResolvedValue([
      { itemId: 'f1', variationId: 'v1-flash', productSlug: 'sp-1', productName: 'Món 1', thumbnail: null, flashPrice: 30_000, retailPrice: 50_000, salePrice: null, soldCount: 0, quota: 10, endAt: '2099-01-01T00:00:00.000Z' },
    ]);
    renderPdp();
    const fbt = await screen.findByTestId('fbt');
    await waitFor(() => expect(within(fbt).getByTestId('fbt-add')).toHaveTextContent('Thêm 3 món vào giỏ · 155.000đ'));
    expect(within(fbt).getAllByTestId('fbt-row').map((r) => r.getAttribute('data-variation-id'))).toEqual(['v0', 'v1-flash', 'v2']);
  });

  describe('giá của món đang xem theo suất Giờ vàng còn lại của khách', () => {
    const flashOnCurrent = {
      itemId: 'f0', variationId: 'v0', productSlug: 'xa-phong', productName: 'Xà phòng sả chanh', thumbnail: null, flashPrice: 60_000, retailPrice: 75_000, salePrice: null,
      soldCount: 0, quota: 10, perUserLimit: 1, endAt: '2099-01-01T00:00:00.000Z',
    };

    it('còn suất (giỏ chưa có món): dòng món đang xem ghi giá Giờ vàng', async () => {
      mocks.fetchFlash.mockResolvedValue([flashOnCurrent]);
      renderPdp();
      const fbt = await screen.findByTestId('fbt');
      await waitFor(() => expect(within(fbt).getByTestId('fbt-add')).toHaveTextContent('Thêm 3 món vào giỏ · 160.000đ'));
    });

    it('giỏ đã đủ suất (giới hạn 1, giỏ có 1): thêm nữa vượt suất nên giỏ tính giá thường, dòng ghi giá thường', async () => {
      mocks.auth.status = 'authenticated';
      mocks.fetchFlash.mockResolvedValue([flashOnCurrent]);
      mocks.getCart.mockResolvedValue({ items: [{ id: 'l0', variationId: 'v0', productId: 'p0', quantity: 1 }], itemCount: 1 });
      renderPdp();
      const fbt = await screen.findByTestId('fbt');
      await waitFor(() => expect(within(fbt).getByTestId('fbt-add')).toHaveTextContent('Thêm 3 món vào giỏ · 175.000đ'));
    });
  });

  it('khối nằm trên Combo/Mua kèm giá tốt và dưới thông tin chính', async () => {
    mocks.getBundles.mockResolvedValue({ combos: [], addons: [] });
    renderPdp();
    const fbt = await screen.findByTestId('fbt');
    const title = screen.getByRole('heading', { level: 1, name: /Xà phòng sả chanh/ });
    expect(title.compareDocumentPosition(fbt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('ProductDetailPage: phân loại không có tên (86/154 phân loại trên PROD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.status = 'idle';
    mocks.fetchBoughtTogether.mockResolvedValue(CARDS);
    mocks.fetchFlash.mockResolvedValue([]);
    mocks.getBundles.mockResolvedValue({ combos: [], addons: [] });
    mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
  });
  const variation = (id: string, name: string, retailPrice: number) => ({ id, sku: id, name, attributes: {}, retailPrice, salePrice: null, stock: 5 });
  const currentRow = async () => (await screen.findAllByTestId('fbt-row'))[0]!.textContent ?? '';
  const chipNames = async () => Array.from((await screen.findByRole('group', { name: 'Phân loại nhanh' })).querySelectorAll('[role="button"]')).map((b) => b.firstElementChild!.textContent);

  it('nhiều phân loại, phân loại đang chọn tên trống hoặc toàn khoảng trắng: khối mua kèm ghi "Tên · Mặc định", chip ghi "Mặc định"', async () => {
    for (const blank of ['', '   ']) {
      mocks.fetchProduct.mockResolvedValue(product({ variations: [variation('v0', blank, 75_000), variation('v1', '1 lít', 90_000)] }));
      const { unmount } = renderPdp();
      expect(await currentRow()).toContain('Xà phòng sả chanh · Mặc định');
      expect(await chipNames()).toEqual(['Mặc định', '1 lít']);
      unmount();
    }
  });

  it('chỉ một phân loại tên trống: khối mua kèm chỉ ghi tên sản phẩm, không có chip nào', async () => {
    mocks.fetchProduct.mockResolvedValue(product({ variations: [variation('v0', '', 75_000)] }));
    renderPdp();
    const row = await currentRow();
    expect(row).toContain('Xà phòng sả chanh');
    expect(row).not.toContain('Xà phòng sả chanh ·');
    expect(screen.queryByRole('group', { name: 'Phân loại nhanh' })).toBeNull();
  });

  it('nhiều phân loại có tên: khối mua kèm ghi "Tên · phân loại đang chọn" như trước', async () => {
    mocks.fetchProduct.mockResolvedValue(product({ variations: [variation('v0', '500ml', 75_000), variation('v1', '1 lít', 90_000)] }));
    renderPdp();
    expect(await currentRow()).toContain('Xà phòng sả chanh · 500ml');
  });
});
