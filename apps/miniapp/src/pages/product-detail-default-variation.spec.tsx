import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchProduct: vi.fn(), fetchActiveFlashSales: vi.fn(), addToCart: vi.fn(), authStatus: 'guest' }));
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
  fetchActiveFlashSales: mocks.fetchActiveFlashSales,
  getCart: vi.fn().mockResolvedValue({ items: [], itemCount: 0 }),
  addToCart: mocks.addToCart,
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => {
  const state = () => ({ status: mocks.authStatus, login: vi.fn(), user: null });
  return { useAuthStore: Object.assign(state, { getState: state }) };
});
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: 0.1 }) }));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const product = {
  id: 'p1', slug: 'gao', brand: 'Cô Lan', name: 'Gạo ST25', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 300_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [
    { id: 'v-1kg', sku: 'B', name: '1kg', attributes: {}, retailPrice: 300_000, salePrice: null, stock: 5 },
    { id: 'v-500', sku: 'A', name: '500g', attributes: {}, retailPrice: 150_000, salePrice: null, stock: 5 },
  ],
};
const flash = (variationId: string, flashPrice: number, retailPrice: number) => ({
  itemId: `f-${variationId}`, productId: 'p1', productSlug: 'gao', productName: 'Gạo ST25', thumbnail: null, variationId,
  retailPrice, flashPrice, quota: 10, soldCount: 1, endAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
});

function renderPdp(state?: { variationId?: string; pinnedVariationId?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: '/product/gao', state }]} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const chip = (name: string) => screen.getAllByText(name)[0]!.closest('[role="button"]') as HTMLElement;

describe('ProductDetailPage — phân loại mở sẵn theo cùng luật với thẻ (đại diện 500g 150.000đ, 1kg 300.000đ)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'guest';
    mocks.fetchProduct.mockResolvedValue(product);
  });

  it('không có Giờ vàng: mở phân loại đại diện 500g', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
    renderPdp();
    await screen.findByText('500g');
    expect(chip('500g')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('1kg')).toHaveAttribute('aria-pressed', 'false');
  });

  it('Giờ vàng 1kg 100.000đ rẻ hơn thẻ, vào không kèm state (gợi ý tìm, bài cộng đồng, Đã xem gần đây): mở 1kg, giá 100.000đ như thẻ', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([flash('v-1kg', 100_000, 300_000)]);
    renderPdp();
    await screen.findByText('1kg');
    expect(chip('1kg')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('100.000đ').length).toBeGreaterThan(0);
  });

  it('Giờ vàng 1kg 250.000đ đắt hơn thẻ: mở 500g, không nhãn Giờ vàng', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([flash('v-1kg', 250_000, 300_000)]);
    renderPdp();
    await screen.findByText('500g');
    expect(chip('500g')).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    ['1kg trước', [flash('v-1kg', 250_000, 300_000), flash('v-500', 120_000, 150_000)]],
    ['500g trước', [flash('v-500', 120_000, 150_000), flash('v-1kg', 250_000, 300_000)]],
  ])('hai suất: mở phân loại của suất thắng (500g 120.000đ), %s', async (_n, items) => {
    mocks.fetchActiveFlashSales.mockResolvedValue(items);
    renderPdp();
    await screen.findByText('500g');
    expect(chip('500g')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('120.000đ').length).toBeGreaterThan(0);
  });

  it('state.variationId còn Giờ vàng: ưu tiên phân loại đó dù suất khác rẻ hơn', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([flash('v-1kg', 140_000, 300_000), flash('v-500', 120_000, 150_000)]);
    renderPdp({ variationId: 'v-1kg' });
    await screen.findByText('1kg');
    expect(chip('1kg')).toHaveAttribute('aria-pressed', 'true');
  });

  it('state.variationId của suất đã hết: về phân loại mặc định', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
    renderPdp({ variationId: 'v-1kg' });
    await screen.findByText('500g');
    expect(chip('500g')).toHaveAttribute('aria-pressed', 'true');
  });

  it('B-140: state.pinnedVariationId (món gian hàng CTV ghim) mở đúng phân loại ghim dù không có Giờ vàng', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
    renderPdp({ pinnedVariationId: 'v-1kg' });
    await screen.findByText('1kg');
    expect(chip('1kg')).toHaveAttribute('aria-pressed', 'true');
  });

  it('trang hiện ngay với phân loại đại diện khi Giờ vàng còn pending; Giờ vàng về thì chốt lại sang phân loại đang giảm', async () => {
    let release: (v: unknown[]) => void = () => undefined;
    mocks.fetchActiveFlashSales.mockReturnValue(new Promise((r) => { release = r; }));
    renderPdp();
    await screen.findByText('500g');
    expect(chip('500g')).toHaveAttribute('aria-pressed', 'true');
    release([flash('v-1kg', 100_000, 300_000)]);
    await waitFor(() => expect(chip('1kg')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('B-145: bấm Thêm vào giỏ là đã chọn, Giờ vàng về muộn không đổi phân loại sau đó', async () => {
    mocks.authStatus = 'authenticated';
    mocks.addToCart.mockResolvedValue({ items: [], itemCount: 1 });
    let release: (v: unknown[]) => void = () => undefined;
    mocks.fetchActiveFlashSales.mockReturnValue(new Promise((r) => { release = r; }));
    renderPdp();
    await screen.findByText('500g');
    fireEvent.click(await screen.findByRole('button', { name: /Thêm vào giỏ/ }));
    const confirm = await screen.findAllByRole('button', { name: /Thêm vào giỏ · / });
    fireEvent.click(confirm[confirm.length - 1]!);
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v-500', 1));
    release([flash('v-1kg', 100_000, 300_000)]);
    await new Promise((r) => setTimeout(r, 30));
    expect(chip('500g')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('1kg')).toHaveAttribute('aria-pressed', 'false');
  });

  it('R-6: từ 2 phân loại, Thêm vào giỏ mở bảng chọn, chọn 1kg rồi xác nhận mới thêm giỏ', async () => {
    mocks.authStatus = 'authenticated';
    mocks.addToCart.mockResolvedValue({ items: [], itemCount: 1 });
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
    renderPdp();
    await screen.findByText('500g');
    fireEvent.click(await screen.findByRole('button', { name: /Thêm vào giỏ/ }));
    const group = await screen.findByRole('group', { name: 'Phân loại' });
    expect(mocks.addToCart).not.toHaveBeenCalled();
    fireEvent.click(group.querySelectorAll('[role="button"]')[0]!);
    const confirm = await screen.findAllByRole('button', { name: /Thêm vào giỏ · / });
    fireEvent.click(confirm[confirm.length - 1]!);
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v-1kg', 1));
  });

  it('R-6: sản phẩm 1 phân loại thêm thẳng, không mở bảng chọn', async () => {
    mocks.authStatus = 'authenticated';
    mocks.addToCart.mockResolvedValue({ items: [], itemCount: 1 });
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
    mocks.fetchProduct.mockResolvedValue({ ...product, variations: [product.variations[0]!] });
    renderPdp();
    await screen.findByText('Gạo ST25');
    fireEvent.click(await screen.findByRole('button', { name: /Thêm vào giỏ/ }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v-1kg', 1));
    expect(screen.queryByRole('group', { name: 'Phân loại' })).toBeNull();
  });

  it('khách đã tự chọn trước khi Giờ vàng về: không bị đổi lại', async () => {
    let release: (v: unknown[]) => void = () => undefined;
    mocks.fetchActiveFlashSales.mockReturnValue(new Promise((r) => { release = r; }));
    renderPdp();
    await screen.findByText('500g');
    fireEvent.click(chip('500g'));
    release([flash('v-1kg', 100_000, 300_000)]);
    await new Promise((r) => setTimeout(r, 30));
    expect(chip('500g')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('1kg')).toHaveAttribute('aria-pressed', 'false');
  });

  it('Giờ vàng của phân loại hết hàng (danh sách cũ): vẫn mở phân loại đại diện còn hàng', async () => {
    mocks.fetchProduct.mockResolvedValue({ ...product, variations: [product.variations[0]!, { ...product.variations[1]!, stock: 0 }].reverse() });
    mocks.fetchActiveFlashSales.mockResolvedValue([flash('v-500', 90_000, 150_000)]);
    renderPdp();
    await screen.findByText('1kg');
    expect(chip('1kg')).toHaveAttribute('aria-pressed', 'true');
  });

  it('Giờ vàng lỗi: vẫn mở trang với phân loại đại diện', async () => {
    mocks.fetchActiveFlashSales.mockRejectedValue(new Error('x'));
    renderPdp();
    await screen.findByText('500g');
    expect(chip('500g')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ProductDetailPage — giao định kỳ tạm ẩn ở Mini App (R-30)', () => {
  it('không hiện dòng "Đặt định kỳ"', async () => {
    mocks.authStatus = 'authenticated';
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
    mocks.fetchProduct.mockResolvedValue(product);
    renderPdp();
    await screen.findAllByText('500g');
    expect(screen.queryByText(/Đặt định kỳ/)).toBeNull();
  });
});
