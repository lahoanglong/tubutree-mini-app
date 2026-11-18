import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkoutEtaLabel } from '@tubutree/app-core/shipping-eta';

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  getCart: vi.fn(),
  auth: { status: 'idle' as string },
  config: {} as Record<string, unknown>,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useSnackbar: () => ({ openSnackbar: vi.fn() }),
  useNavigate: () => vi.fn(),
}));
vi.mock('../../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  fetchRelated: vi.fn().mockResolvedValue([]),
  fetchBoughtTogether: vi.fn().mockResolvedValue([]),
  fetchReviews: vi.fn().mockResolvedValue({ data: [], count: 0, average: 0 }),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: mocks.getCart,
  addToCart: vi.fn(),
}));
vi.mock('../../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../../store/auth', () => ({ useAuthStore: () => ({ status: mocks.auth.status, login: vi.fn() }) }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.config }));
vi.mock('../reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from '../../pages/product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const ETA = { minDays: 2, maxDays: 4 };
const TUBU = { kind: 'TUBU', name: 'Tubu Tree', shippingFee: null, freeShipFrom: null };
const variation = (id: string, name: string, price: number, stock = 5) => ({ id, sku: id, name, attributes: {}, retailPrice: price, salePrice: null, stock });
const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1', slug: 'nuoc-giat', brand: 'Fuwa3e', name: 'Nước giặt hương Bạc hà', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 79_000, salePrice: null, certifications: [], ingredients: null, sold: 0, fulfiller: TUBU,
  variations: [variation('a', '500ml', 79_000), variation('b', '3,5L', 375_000), variation('c', 'Refill 10L', 990_000)],
  ...over,
});
const cart = (over: Record<string, unknown> = {}) => ({
  items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199_000, itemCount: 0, unavailableItems: [], ...over,
});
const cartLine = (variationId: string, total: number) => ({
  id: `l-${variationId}`, variationId, productName: 'x', variationName: 'x', slug: 'x', thumbnail: null, unitPrice: total, quantity: 1, stock: 9, total,
  fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' },
});

function renderPdp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/product/nuoc-giat']} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseConfig = { isLoaded: true, freeshipThreshold: 199_000, subscribeDiscountPct: 0.12, groupBuy: { discountPct: 15, targetSize: 3 }, shippingEta: ETA };

describe('Trang chi tiết Mini: giá theo đơn vị, ngày nhận dự kiến, còn thiếu để miễn phí giao (tubu-w4-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(product());
    mocks.auth.status = 'idle';
    mocks.config = { ...baseConfig };
  });

  it('hai cờ tắt: không thêm dòng nào, câu miễn phí giao giữ câu tĩnh cũ', async () => {
    renderPdp();
    expect(await screen.findByText('Miễn phí giao hàng cho đơn từ 199.000đ')).toBeInTheDocument();
    expect(screen.queryByTestId('pdp-unit-price')).toBeNull();
    expect(screen.queryByTestId('variation-unit-price')).toBeNull();
    expect(screen.queryByTestId('pdp-eta')).toBeNull();
    expect(screen.queryByTestId('pdp-freeship-gap')).toBeNull();
    expect(screen.queryByText(/Lợi hơn/)).toBeNull();
  });

  it('cờ giá theo đơn vị: dòng dưới giá, mỗi chip một dòng giá theo đơn vị, đúng một nhãn "Lợi hơn"', async () => {
    mocks.config = { ...baseConfig, unitPriceEnabled: true };
    renderPdp();
    expect(await screen.findByTestId('pdp-unit-price')).toHaveTextContent('≈ 15.800đ / 100ml');
    const chips = within(screen.getByRole('group', { name: 'Phân loại nhanh' }));
    expect(chips.getAllByTestId('variation-unit-price').map((n) => n.textContent)).toEqual([
      '≈ 15.800đ / 100ml',
      '≈ 10.700đ / 100ml',
      '≈ 9.900đ / 100ml · Lợi hơn 37% mỗi 100ml',
    ]);
    expect(screen.getAllByText(/Lợi hơn/)).toHaveLength(1);
  });

  it('cờ giá theo đơn vị nhưng một phân loại không đọc được lượng: không hiện gì (không đoán)', async () => {
    mocks.config = { ...baseConfig, unitPriceEnabled: true };
    mocks.fetchProduct.mockResolvedValue(product({ variations: [variation('a', '500ml', 79_000), variation('b', 'Combo 2', 150_000)] }));
    renderPdp();
    expect(await screen.findByText('Miễn phí giao hàng cho đơn từ 199.000đ')).toBeInTheDocument();
    expect(screen.queryByTestId('pdp-unit-price')).toBeNull();
    expect(screen.queryByTestId('variation-unit-price')).toBeNull();
  });

  it('cờ ngày nhận: khách chưa đăng nhập thấy cùng khoảng ngày với thanh toán và số còn thiếu theo ngưỡng chung', async () => {
    mocks.config = { ...baseConfig, pdpEtaEnabled: true };
    renderPdp();
    expect(await screen.findByTestId('pdp-eta')).toHaveTextContent(`Nhận dự kiến ${checkoutEtaLabel(ETA, ['TUBU'])}`);
    expect(screen.getByTestId('pdp-freeship-gap')).toHaveTextContent('Món này + 120.000đ là miễn phí giao');
    expect(screen.queryByText('Miễn phí giao hàng cho đơn từ 199.000đ')).toBeNull();
    expect(mocks.getCart).not.toHaveBeenCalled();
  });

  it('đổi ngưỡng cấu hình thành 250.000đ thì số còn thiếu đổi theo (không ghi cứng 199.000đ)', async () => {
    mocks.config = { ...baseConfig, pdpEtaEnabled: true, freeshipThreshold: 250_000 };
    renderPdp();
    expect(await screen.findByTestId('pdp-freeship-gap')).toHaveTextContent('Món này + 171.000đ là miễn phí giao');
  });

  it('khách có hạng với ngưỡng riêng thấp hơn: giỏ + món này đủ thì không bị báo còn thiếu', async () => {
    mocks.config = { ...baseConfig, pdpEtaEnabled: true };
    mocks.auth.status = 'authenticated';
    mocks.getCart.mockResolvedValue(cart({ freeshipThreshold: 149_000, items: [cartLine('x', 70_000)] }));
    renderPdp();
    expect(await screen.findByText('Thêm món này là đủ miễn phí giao')).toBeInTheDocument();
    expect(screen.queryByText(/^Món này \+/)).toBeNull();
  });

  it('giỏ đã đủ ngưỡng: chỉ nói đơn đã được miễn phí giao', async () => {
    mocks.config = { ...baseConfig, pdpEtaEnabled: true };
    mocks.auth.status = 'authenticated';
    mocks.getCart.mockResolvedValue(cart({ items: [cartLine('x', 210_000)] }));
    renderPdp();
    expect(await screen.findByText('Đơn này được miễn phí giao hàng')).toBeInTheDocument();
  });

  it('đang khôi phục phiên: chưa biết giỏ nên không nói số còn thiếu', async () => {
    mocks.config = { ...baseConfig, pdpEtaEnabled: true };
    mocks.auth.status = 'loading';
    renderPdp();
    expect(await screen.findByTestId('pdp-eta')).toBeInTheDocument();
    expect(screen.queryByTestId('pdp-freeship-gap')).toBeNull();
  });

  it('hàng gian hàng tự giao: không hứa ngày, số còn thiếu theo ngưỡng của gian hàng', async () => {
    mocks.config = { ...baseConfig, pdpEtaEnabled: true };
    mocks.fetchProduct.mockResolvedValue(
      product({ fulfiller: { kind: 'MERCHANT', name: 'Shop A', shippingFee: 20_000, freeShipFrom: 300_000 }, variations: [variation('a', '500ml', 79_000)] }),
    );
    renderPdp();
    expect(await screen.findByTestId('pdp-freeship-gap')).toHaveTextContent('Món này + 221.000đ là miễn phí giao');
    expect(screen.queryByTestId('pdp-eta')).toBeNull();
  });

  it('hàng gian hàng có ngưỡng, chưa biết giỏ: giữ sẵn một dòng ẩn để câu còn thiếu điền vào sau không đẩy phần dưới', async () => {
    mocks.config = { ...baseConfig, pdpEtaEnabled: true };
    mocks.auth.status = 'loading';
    mocks.fetchProduct.mockResolvedValue(
      product({ fulfiller: { kind: 'MERCHANT', name: 'Shop A', shippingFee: 20_000, freeShipFrom: 300_000 }, variations: [variation('a', '500ml', 79_000)] }),
    );
    renderPdp();
    expect(await screen.findByText('Shop A tự giao')).toBeInTheDocument();
    expect(screen.queryByTestId('pdp-freeship-gap')).toBeNull();
    const reserved = [...document.querySelectorAll('[aria-hidden="true"]')].filter((el) => el.textContent === ' ' && (el as HTMLElement).style.visibility === 'hidden');
    expect(reserved).toHaveLength(1);
  });

  it('hết hàng: không hứa ngày, giữ câu miễn phí giao tĩnh', async () => {
    mocks.config = { ...baseConfig, pdpEtaEnabled: true };
    mocks.fetchProduct.mockResolvedValue(product({ variations: [variation('a', '500ml', 79_000, 0)] }));
    renderPdp();
    expect(await screen.findByText('Miễn phí giao hàng cho đơn từ 199.000đ')).toBeInTheDocument();
    expect(screen.queryByTestId('pdp-eta')).toBeNull();
    expect(screen.queryByTestId('pdp-freeship-gap')).toBeNull();
  });
});
