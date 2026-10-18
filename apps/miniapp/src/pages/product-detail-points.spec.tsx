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

function renderPdp(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
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
    expect(await screen.findByText('Nhận tối đa 5.000 Điểm Xanh (≈5.000đ) khi đơn giao thành công')).toBeInTheDocument();
  });

  it('số theo tỉ lệ admin đặt, không theo số cứng: 1,5% và 0,5đ/điểm', async () => {
    mocks.config = { isLoaded: true, loyalty: { earnPct: 1.5, vndPerPoint: 67, vndPerPointRedeem: 0.5 } };
    renderPdp();
    expect(await screen.findByText('Nhận tối đa 3.750 Điểm Xanh (≈1.875đ) khi đơn giao thành công')).toBeInTheDocument();
  });

  it('API cũ chưa trả mốc điểm: chỉ nói chung, không có con số', async () => {
    mocks.config = { isLoaded: true };
    renderPdp();
    expect(await screen.findByText('Nhận Điểm Xanh khi đơn giao thành công')).toBeInTheDocument();
    expect(screen.queryByText(/Nhận tối đa/)).toBeNull();
  });

  it('tài khoản có hạng mà chưa biết hệ số: nói chung; khi tổng quan Điểm Xanh đã có trong bộ nhớ đệm thì nhân hệ số hạng', async () => {
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { tierId: 'LOC_BIEC' };
    const first = renderPdp();
    expect(await screen.findByText('Nhận Điểm Xanh khi đơn giao thành công')).toBeInTheDocument();
    first.unmount();

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['loyalty'], { tier: { id: 'LOC_BIEC', name: 'Lộc Biếc', multiplier: 1.2, perks: null } });
    renderPdp(qc);
    expect(await screen.findByText('Nhận tối đa 6.000 Điểm Xanh (≈6.000đ) khi đơn giao thành công')).toBeInTheDocument();
  });

  it('tài khoản chưa có hạng: hệ số 1 như server (getTierMultiplier null → 1)', async () => {
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { tierId: null };
    renderPdp();
    expect(await screen.findByText('Nhận tối đa 5.000 Điểm Xanh (≈5.000đ) khi đơn giao thành công')).toBeInTheDocument();
  });

  // Overview trả hạng thấp nhất (hệ số 1.2) cho tài khoản chưa có hạng, nhưng server tích với hệ số 1.
  it('tài khoản chưa có hạng, tổng quan trong bộ nhớ đệm hiển thị hạng thấp nhất hệ số 1.2 (chưa có earnMultiplier): vẫn hệ số 1', async () => {
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { tierId: null };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['loyalty'], { tier: { id: 'MAM_XANH', name: 'Mầm Xanh', multiplier: 1.2, perks: null } });
    renderPdp(qc);
    expect(await screen.findByText('Nhận tối đa 5.000 Điểm Xanh (≈5.000đ) khi đơn giao thành công')).toBeInTheDocument();
  });

  it('tài khoản chưa có hạng, API trả earnMultiplier 1 kèm hạng hiển thị hệ số 1.2: dùng 1', async () => {
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { tierId: null };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['loyalty'], { earnMultiplier: 1, tier: { id: 'MAM_XANH', name: 'Mầm Xanh', multiplier: 1.2, perks: null } });
    renderPdp(qc);
    expect(await screen.findByText('Nhận tối đa 5.000 Điểm Xanh (≈5.000đ) khi đơn giao thành công')).toBeInTheDocument();
  });

  it('tài khoản có hạng: ưu tiên earnMultiplier server trả (1.5) hơn hệ số của hạng hiển thị', async () => {
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { tierId: 'LOC_BIEC' };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['loyalty'], { earnMultiplier: 1.5, tier: { id: 'LOC_BIEC', name: 'Lộc Biếc', multiplier: 1.2, perks: null } });
    renderPdp(qc);
    expect(await screen.findByText('Nhận tối đa 7.500 Điểm Xanh (≈7.500đ) khi đơn giao thành công')).toBeInTheDocument();
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
});
