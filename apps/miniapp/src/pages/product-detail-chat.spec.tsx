import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchProduct: vi.fn(), fetchRelated: vi.fn(), fetchBoughtTogether: vi.fn(), openOAChat: vi.fn(), hasOA: true, chatOn: false, authStatus: 'guest', navigate: vi.fn(), login: vi.fn() }));
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
  fetchReviews: vi.fn().mockResolvedValue({ data: [], count: 0, average: 0 }),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn().mockResolvedValue({ items: [], itemCount: 0 }),
  addToCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({
  shareLink: vi.fn(),
  openOAChat: mocks.openOAChat,
  get hasOA() {
    return mocks.hasOA;
  },
}));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: mocks.authStatus, login: mocks.login }) }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: 0.1, chat: { enabled: mocks.chatOn, hours: { start: '08:00', end: '21:00' } } }) }));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const variations = [
  { id: 'v1', sku: 'S1', name: '500ml', attributes: {}, retailPrice: 75_000, salePrice: null, stock: 5 },
  { id: 'v2', sku: 'S2', name: '1 lít', attributes: {}, retailPrice: 120_000, salePrice: null, stock: 5 },
];
const product = {
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 75_000, salePrice: null, certifications: [], ingredients: null, sold: 0, variations,
};
const related = { id: 'p2', slug: 'nuoc-rua', brand: 'Cô Lan', name: 'Nước rửa chén', thumbnail: null, basePrice: 65_000, salePrice: null, sold: 0 };

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

describe('ProductDetailPage — nút Chat Zalo OA trong khối "Cam kết Tubu" (D7 #3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasOA = true;
    mocks.chatOn = false;
    mocks.authStatus = 'guest';
    mocks.fetchProduct.mockResolvedValue(product);
    mocks.fetchRelated.mockResolvedValue([]);
    mocks.fetchBoughtTogether.mockResolvedValue([]);
  });

  it('OA đã cấu hình: nút Chat nằm trong khối "Cam kết Tubu"; bấm mở chat OA kèm tên sản phẩm', async () => {
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    const block = screen.getByRole('heading', { name: 'Cam kết Tubu' }).parentElement!;
    const chat = within(block).getByRole('button', { name: 'Chat với Tubu Tree' });
    fireEvent.click(chat);
    expect(mocks.openOAChat).toHaveBeenCalledTimes(1);
    expect(mocks.openOAChat).toHaveBeenCalledWith(expect.stringContaining('Xà phòng sả chanh'));
  });

  it('thanh CTA dính giữ bố cục cũ: chỉ nút giỏ 48px, không có nút Chat làm hẹp hai nút chính', async () => {
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    const bar = screen.getByTestId('sticky-bar');
    expect(within(bar).queryByRole('button', { name: 'Chat với Tubu Tree' })).toBeNull();
    const cart = within(bar).getByRole('button', { name: 'Xem giỏ hàng' });
    expect(cart.style.width).toBe('48px');
  });

  it('vùng chạm nút Chat >= 44px', async () => {
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    const chat = screen.getByRole('button', { name: 'Chat với Tubu Tree' });
    expect(parseInt(chat.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });

  it('OA chưa cấu hình: không có nút Chat', async () => {
    mocks.hasOA = false;
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    expect(screen.queryByRole('button', { name: 'Chat với Tubu Tree' })).toBeNull();
    expect(within(screen.getByTestId('sticky-bar')).getByRole('button', { name: 'Xem giỏ hàng' })).toBeInTheDocument();
  });
});

describe('ProductDetailPage — chat với Tubu Tree khi chat bật', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasOA = true;
    mocks.chatOn = true;
    mocks.fetchProduct.mockResolvedValue(product);
    mocks.fetchRelated.mockResolvedValue([]);
    mocks.fetchBoughtTogether.mockResolvedValue([]);
  });

  it('đã đăng nhập: nút Chat mở /chat?product=<slug>, không mở OA', async () => {
    mocks.authStatus = 'authenticated';
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    fireEvent.click(screen.getByRole('button', { name: 'Chat với Tubu Tree' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/chat?product=xa-phong');
    expect(mocks.openOAChat).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Đăng nhập để chat với Tubu Tree' })).toBeNull();
  });

  it('chưa đăng nhập: giữ nút OA cũ và thêm lời mời đăng nhập, không đẩy sang /chat', async () => {
    mocks.authStatus = 'guest';
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    fireEvent.click(screen.getByRole('button', { name: 'Chat với Tubu Tree' }));
    expect(mocks.openOAChat).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập để chat với Tubu Tree' }));
    expect(mocks.login).toHaveBeenCalled();
  });

  it('đang khôi phục phiên: không có lời mời đăng nhập', async () => {
    mocks.authStatus = 'loading';
    renderPdp();
    await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    expect(screen.queryByRole('button', { name: 'Đăng nhập để chat với Tubu Tree' })).toBeNull();
  });
});

describe('ProductDetailPage — tên SP và tiêu đề mục cùng một kiểu chữ (D7 #3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasOA = false;
    mocks.fetchProduct.mockResolvedValue(product);
    mocks.fetchRelated.mockResolvedValue([related]);
    mocks.fetchBoughtTogether.mockResolvedValue([related]);
  });

  it('tên SP là h1 đậm 600, cỡ title-md của DS (lớn hơn tiêu đề mục)', async () => {
    renderPdp();
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
    expect(h1.style.fontWeight).toBe('var(--type-title-md-weight)');
    expect(h1.style.fontSize).toBe('var(--type-title-md-size)');
    expect(h1.style.fontFamily).toBe('var(--font-ui)');
  });

  it.each(['Phân loại', 'Cam kết Tubu', 'Mô tả sản phẩm', 'Thường mua kèm', 'Cùng nhà Cô Lan'])(
    'tiêu đề mục "%s" là h2 Inter 16/600 (title-sm)',
    async (title) => {
      renderPdp();
      await screen.findByRole('heading', { level: 1, name: 'Xà phòng sả chanh' });
      const h2 = await screen.findByRole('heading', { level: 2, name: title });
      expect(h2.style.fontFamily).toBe('var(--font-ui)');
      expect(h2.style.fontSize).toBe('var(--type-title-sm-size)');
      expect(h2.style.fontWeight).toBe('var(--type-title-sm-weight)');
    },
  );
});
