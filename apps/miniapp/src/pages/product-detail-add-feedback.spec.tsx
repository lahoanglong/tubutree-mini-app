import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// PL-12: thêm giỏ xong thì chính nút xác nhận ("Đã thêm" 1,2 giây), không còn thanh thông báo đầu màn khi không có ghi chú đi kèm.

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  applyCoupon: vi.fn(),
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  fetchRelated: vi.fn().mockResolvedValue([]),
  fetchBoughtTogether: vi.fn().mockResolvedValue([]),
  fetchReviews: vi.fn().mockResolvedValue({ data: [], count: 0, average: 0 }),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn().mockResolvedValue({ items: [], itemCount: 0 }),
  addToCart: mocks.addToCart,
  applyCoupon: mocks.applyCoupon,
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
}));
vi.mock('../services/account-api', () => ({ getCoupons: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn(), hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', login: vi.fn(), user: { id: 'u1' } };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, freeshipThreshold: 200_000, subscribeDiscountPct: 0.1 }) }));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';
import { useAnnouncements } from '../hooks/use-notify';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const CODE = 'GBUY-ABCD1234-WXYZ5678';
const PRODUCT = {
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 100_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: 'Mặc định', attributes: {}, retailPrice: 100_000, salePrice: null, stock: 5 }],
};
const cart = (over: Record<string, unknown> = {}) => ({
  items: [{ id: 'line1', variationId: 'v1', quantity: 1 }], itemCount: 1, couponCode: null, discount: 0, ...over,
});

function Announced() {
  return <output data-testid="announced">{useAnnouncements().status}</output>;
}

function renderPdp(state: Record<string, unknown> | null = { variationId: 'v1' }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Announced />
      <MemoryRouter initialEntries={[{ pathname: '/product/xa-phong', state }]} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const addBtn = () => screen.getByRole('button', { name: 'Thêm vào giỏ' });

async function openPdp(state?: Record<string, unknown> | null) {
  renderPdp(state);
  await advance(30);
  await advance(30);
}

describe('ProductDetailPage — nút thêm giỏ tự xác nhận (PL-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.fetchProduct.mockResolvedValue(PRODUCT);
    mocks.addToCart.mockResolvedValue(cart());
    mocks.applyCoupon.mockResolvedValue(cart({ couponCode: CODE, discount: 15_000 }));
  });
  afterEach(() => vi.useRealTimers());

  it('thêm giỏ xong: nút đổi thành "Đã thêm" kèm dấu tick đúng 1,2 giây rồi về "Thêm vào giỏ"', async () => {
    await openPdp();
    fireEvent.click(addBtn());
    await advance(30);
    const done = screen.getByRole('button', { name: 'Đã thêm' });
    expect(done.querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm vào giỏ' })).toBeNull();
    await advance(1_100);
    expect(screen.getByRole('button', { name: 'Đã thêm' })).toBeInTheDocument();
    await advance(100);
    expect(addBtn()).toBeInTheDocument();
  });

  it('không có ghi chú đi kèm: không mở thanh thông báo, chỉ ghi vùng đọc role=status "Đã thêm vào giỏ"', async () => {
    await openPdp();
    fireEvent.click(addBtn());
    await advance(200);
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    expect(screen.getByTestId('announced')).toHaveTextContent('Đã thêm vào giỏ');
  });

  it('có ghi chú đi kèm (mã mua chung): vẫn báo bằng thanh thông báo như trước', async () => {
    await openPdp({ variationId: 'v1', applyCoupon: CODE });
    fireEvent.click(addBtn());
    await advance(200);
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Đã thêm vào giỏ') }));
  });

  it('bấm lần hai khi đang "Đã thêm": cửa sổ 1,2 giây tính lại từ lần bấm sau', async () => {
    await openPdp();
    fireEvent.click(addBtn());
    await advance(30);
    await advance(900);
    fireEvent.click(screen.getByRole('button', { name: 'Đã thêm' }));
    await advance(30);
    await advance(900);
    expect(screen.getByRole('button', { name: 'Đã thêm' })).toBeInTheDocument();
    await advance(400);
    expect(addBtn()).toBeInTheDocument();
  });

  it('thêm giỏ lỗi: nút không đổi thành "Đã thêm"', async () => {
    mocks.addToCart.mockRejectedValue(new Error('Chỉ còn 0 sản phẩm'));
    await openPdp();
    fireEvent.click(addBtn());
    await advance(30);
    expect(screen.queryByRole('button', { name: 'Đã thêm' })).toBeNull();
    expect(addBtn()).toBeInTheDocument();
  });
});
