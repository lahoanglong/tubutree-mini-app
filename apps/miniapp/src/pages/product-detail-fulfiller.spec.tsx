import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchProduct: vi.fn() }));
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
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({
    isLoaded: true,
    freeshipThreshold: 200_000,
    subscribeDiscountPct: 0.12,
    groupBuy: { discountPct: 15, targetSize: 3 },
  }),
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
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 75_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: 'Mặc định', attributes: {}, retailPrice: 75_000, salePrice: null, stock: 5 }],
  ...over,
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

describe('ProductDetailPage — ai giao hàng (D4, R2-BUYERMINI-1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hàng gian hàng tự giao: ghi rõ gian hàng giao + phí/ngưỡng của gian hàng, không hứa freeship của Tubu', async () => {
    mocks.fetchProduct.mockResolvedValue(
      product({ fulfiller: { kind: 'MERCHANT', name: 'Xà phòng Cô Lan', shippingFee: 22_000, freeShipFrom: 300_000 } }),
    );
    renderPdp();
    expect(await screen.findByText('Xà phòng Cô Lan tự giao')).toBeInTheDocument();
    expect(screen.getByText('Phí giao 22.000đ, miễn phí cho đơn của gian hàng từ 300.000đ')).toBeInTheDocument();
    expect(screen.queryByText(/Miễn phí giao hàng cho đơn từ 200\.000đ/)).toBeNull();
  });

  it('R3-MERCHANT-2: tên gian hàng mặc định đã có chữ "Gian hàng" thì không ghi lặp, và nói rõ chỉ nhận COD hoặc Ví Tubu', async () => {
    mocks.fetchProduct.mockResolvedValue(
      product({ fulfiller: { kind: 'MERCHANT', name: 'Gian hàng của Nguyễn Văn Shop A', shippingFee: 30_000, freeShipFrom: null } }),
    );
    renderPdp();
    expect(await screen.findByText('Gian hàng của Nguyễn Văn Shop A tự giao')).toBeInTheDocument();
    expect(screen.queryByText(/Gian hàng Gian hàng/)).toBeNull();
    expect(screen.getByText(/Thanh toán khi nhận hàng \(COD\) hoặc bằng Ví Tubu, không nhận chuyển khoản hay ZaloPay/)).toBeInTheDocument();
  });

  it('R3-MERCHANT-3: gian hàng tạm nghỉ → báo chưa nhận đơn, tắt nút mua, không mời đặt định kỳ/mua chung', async () => {
    mocks.fetchProduct.mockResolvedValue(
      product({ fulfiller: { kind: 'UNAVAILABLE', reason: 'STORE_PAUSED', name: 'Shop A', shippingFee: null, freeShipFrom: null } }),
    );
    renderPdp();
    expect(await screen.findByText('Shop A đang tạm nghỉ, chưa nhận đơn.')).toBeInTheDocument();
    const blocked = screen.getByRole('button', { name: 'Tạm thời chưa mua được' });
    expect(blocked).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Thêm vào giỏ' })).toBeNull();
    expect(screen.queryByText(/Mua ngay/)).toBeNull();
    expect(screen.queryByText(/Miễn phí giao hàng/)).toBeNull();
    expect(screen.queryByText(/Đặt định kỳ/)).toBeNull();
    expect(screen.queryByText(/Mở nhóm mua chung/)).toBeNull();
  });

  it('R3-MERCHANT-3: gian hàng đã ngừng bán → nói đã ngừng bán', async () => {
    mocks.fetchProduct.mockResolvedValue(
      product({ fulfiller: { kind: 'UNAVAILABLE', reason: 'STORE_CLOSED', name: 'Nến Shop B', shippingFee: null, freeShipFrom: null } }),
    );
    renderPdp();
    expect(await screen.findByText('Nến Shop B đã ngừng bán trên Tubu Tree.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tạm thời chưa mua được' })).toBeDisabled();
  });

  it('hàng gian hàng tự giao: không có "Đặt định kỳ" và "Mở nhóm mua chung", có câu giải thích', async () => {
    mocks.fetchProduct.mockResolvedValue(
      product({ fulfiller: { kind: 'MERCHANT', name: 'Shop A', shippingFee: 30_000, freeShipFrom: null } }),
    );
    renderPdp();
    expect(await screen.findByText('Phí giao 30.000đ')).toBeInTheDocument();
    expect(screen.getByText('Hàng gian hàng tự giao chỉ bán theo giá lẻ, không dùng Điểm Xanh, chưa đặt định kỳ hay mua chung được.')).toBeInTheDocument();
    expect(screen.queryByText('Tubu Tree giao hàng')).toBeNull();
    expect(screen.queryByText(/Đặt định kỳ/)).toBeNull();
    expect(screen.queryByText(/Mở nhóm mua chung/)).toBeNull();
  });

  it('hàng Tubu giao: giữ badge freeship của Tubu, "Đặt định kỳ" (vùng chạm >= 44px) và mua chung', async () => {
    mocks.fetchProduct.mockResolvedValue(product({ fulfiller: { kind: 'TUBU', name: 'Tubu Tree', shippingFee: null, freeShipFrom: null } }));
    renderPdp();
    expect(await screen.findByText('Miễn phí giao hàng cho đơn từ 200.000đ')).toBeInTheDocument();
    expect(screen.getByText('Tubu Tree giao hàng')).toBeInTheDocument();
    expect(screen.queryByText(/không dùng Điểm Xanh/)).toBeNull();
    const subscribe = screen.getByText(/Đặt định kỳ/).closest('[role="button"]') as HTMLElement;
    expect(subscribe.style.minHeight).toBe('44px');
    expect(screen.getByText(/Mở nhóm mua chung/)).toBeInTheDocument();
    expect(screen.queryByText(/tự giao/)).toBeNull();
  });

  it('Q8 S2: hàng Tubu giao hộ của gian hàng đối tác: vẫn hứa freeship của Tubu nhưng không có "Đặt định kỳ" và mua chung, có câu giải thích', async () => {
    mocks.fetchProduct.mockResolvedValue(
      product({ partnerOwned: true, fulfiller: { kind: 'TUBU', name: 'Tubu Tree', shippingFee: null, freeShipFrom: null } }),
    );
    renderPdp();
    expect(await screen.findByText('Miễn phí giao hàng cho đơn từ 200.000đ')).toBeInTheDocument();
    expect(screen.getByText('Tubu Tree giao hàng')).toBeInTheDocument();
    expect(screen.getByText('Hàng của gian hàng đối tác chỉ bán theo giá lẻ, không dùng Điểm Xanh, chưa đặt định kỳ hay mua chung được.')).toBeInTheDocument();
    expect(screen.queryByText(/Đặt định kỳ/)).toBeNull();
    expect(screen.queryByText(/Mở nhóm mua chung/)).toBeNull();
  });

  it('API cũ chưa trả fulfiller → coi như hàng Tubu (hành vi cũ)', async () => {
    mocks.fetchProduct.mockResolvedValue(product());
    renderPdp();
    expect(await screen.findByText('Miễn phí giao hàng cho đơn từ 200.000đ')).toBeInTheDocument();
    expect(screen.getByText(/Đặt định kỳ/)).toBeInTheDocument();
  });
});
