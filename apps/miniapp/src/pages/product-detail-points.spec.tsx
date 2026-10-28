import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// D2-07c: dòng "Nhận … Điểm Xanh" ở PDP chỉ hiện con số khi chắc chắn khớp công thức server.
const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  getCart: vi.fn(),
  auth: { status: 'idle' as string, user: null as { tierId?: string | null } | null },
  config: { isLoaded: true, loyalty: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1 } } as Record<string, unknown>,
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
  fetchBoughtTogether: vi.fn().mockResolvedValue([]),
  fetchReviews: vi.fn().mockResolvedValue({ data: [], count: 0, average: 0 }),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: mocks.getCart,
  addToCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ status: mocks.auth.status, user: mocks.auth.user, login: vi.fn() }) }));
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({ freeshipThreshold: 200_000, subscribeDiscountPct: 0.12, ...mocks.config }),
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
const product = (price: number) => ({
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: price, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: 'Mặc định', attributes: {}, retailPrice: price, salePrice: null, stock: 5 }],
});

function renderPdp(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }), state?: Record<string, unknown>) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: '/product/xa-phong', state }]} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductDetailPage — dòng Điểm Xanh sẽ nhận (D2-07c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(product(250_000));
    mocks.getCart.mockResolvedValue({ items: [], freeshipThreshold: 200_000, itemCount: 0 });
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    mocks.config = { isLoaded: true, loyalty: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1 } };
  });

  it('khách chưa đăng nhập: số điểm và giá trị quy đổi theo tỉ lệ trong config công khai (250.000đ × 2% = 5.000 điểm)', async () => {
    renderPdp();
    expect(await screen.findByText('Nhận ~5.000 Điểm Xanh')).toBeInTheDocument();
  });

  it('số theo tỉ lệ admin đặt, không theo số cứng: 1,5% và 0,5đ/điểm', async () => {
    mocks.config = { isLoaded: true, loyalty: { earnPct: 1.5, vndPerPoint: 67, vndPerPointRedeem: 0.5 } };
    renderPdp();
    expect(await screen.findByText('Nhận ~3.750 Điểm Xanh')).toBeInTheDocument();
  });

  it('API cũ chưa trả mốc điểm: chỉ nói chung, không có con số', async () => {
    mocks.config = { isLoaded: true };
    renderPdp();
    expect(await screen.findByText('Nhận Điểm Xanh khi đơn giao thành công')).toBeInTheDocument();
    expect(screen.queryByText(/Nhận ~/)).toBeNull();
  });

  const TIERS = { tierMultipliers: { MAM_XANH: 1, LOC_BIEC: 1.2, DAI_THU: 1.25 }, tierNames: { MAM_XANH: 'Mầm Xanh', LOC_BIEC: 'Lộc Biếc', DAI_THU: 'Đại Thụ' } };
  const withTiers = () => {
    mocks.config = { isLoaded: true, loyalty: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1, ...TIERS } };
  };

  it('tài khoản có hạng: nhân hệ số từ bảng hạng trong config công khai và nói rõ hạng, không cần cache loyalty', async () => {
    withTiers();
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { tierId: 'LOC_BIEC' };
    renderPdp();
    expect(await screen.findByText('Nhận ~6.000 Điểm Xanh')).toBeInTheDocument();
  });

  it('hệ số lẻ hai số: ×1,25 và số điểm theo cùng công thức server (250.000đ × 2% × 1,25 = 6.250)', async () => {
    withTiers();
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { tierId: 'DAI_THU' };
    renderPdp();
    expect(await screen.findByText('Nhận ~6.250 Điểm Xanh')).toBeInTheDocument();
  });

  it('hạng Mầm Xanh (hệ số 1): số gốc, không giải thích', async () => {
    withTiers();
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { tierId: 'MAM_XANH' };
    renderPdp();
    expect(await screen.findByText('Nhận ~5.000 Điểm Xanh')).toBeInTheDocument();
  });

  it('tài khoản có hạng nhưng config chưa có bảng hạng (API cũ) hoặc phiên cũ thiếu tierId: nói chung, không đoán', async () => {
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { tierId: 'LOC_BIEC' };
    const first = renderPdp();
    expect(await screen.findByText('Nhận Điểm Xanh khi đơn giao thành công')).toBeInTheDocument();
    first.unmount();
    withTiers();
    mocks.auth.user = {};
    renderPdp();
    expect(await screen.findByText('Nhận Điểm Xanh khi đơn giao thành công')).toBeInTheDocument();
  });

  it('tài khoản chưa có hạng: hệ số 1 như server (getTierMultiplier null → 1), dù cache loyalty có hạng thấp nhất hệ số 1.2', async () => {
    withTiers();
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { tierId: null };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['loyalty'], { tier: { id: 'MAM_XANH', name: 'Mầm Xanh', multiplier: 1.2, perks: null } });
    renderPdp(qc);
    expect(await screen.findByText('Nhận ~5.000 Điểm Xanh')).toBeInTheDocument();
  });

  it('đang kiểm tra phiên đăng nhập: chưa hứa số nào', async () => {
    mocks.auth.status = 'loading';
    renderPdp();
    expect(await screen.findByText('Nhận Điểm Xanh khi đơn giao thành công')).toBeInTheDocument();
  });

  it('hàng rẻ hơn một mốc điểm (9.000đ): không hiện dòng nào', async () => {
    mocks.fetchProduct.mockResolvedValue(product(9_000));
    renderPdp();
    expect(await screen.findByText('Xà phòng sả chanh')).toBeInTheDocument();
    expect(screen.queryByText(/Điểm Xanh khi đơn giao thành công/)).toBeNull();
  });

  describe('lối vào từ kệ Mua lại (không có Giờ vàng)', () => {
    const twoVariations = () => ({
      ...product(100_000),
      variations: [
        { id: 'v1', sku: 'S1', name: 'Nhỏ', attributes: {}, retailPrice: 100_000, salePrice: null, stock: 5 },
        { id: 'v2', sku: 'S2', name: 'Lớn', attributes: {}, retailPrice: 250_000, salePrice: null, stock: 5 },
      ],
    });

    it('state { pinnedVariationId } mở đúng phân loại đã mua dù đắt hơn: giá trang (qua dòng điểm) khớp giá thẻ 250.000đ', async () => {
      mocks.fetchProduct.mockResolvedValue(twoVariations());
      renderPdp(undefined, { pinnedVariationId: 'v2' });
      expect(await screen.findByText('Nhận ~5.000 Điểm Xanh')).toBeInTheDocument();
    });

    it('state { variationId } khi phân loại đó không có Giờ vàng thì KHÔNG đủ để mở nó (đó là lý do kệ phải dùng pinnedVariationId)', async () => {
      mocks.fetchProduct.mockResolvedValue(twoVariations());
      renderPdp(undefined, { variationId: 'v2' });
      expect(await screen.findByText('Nhận ~2.000 Điểm Xanh')).toBeInTheDocument();
    });
  });
});
