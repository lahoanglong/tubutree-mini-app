import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Nhóm mua chung đủ người: nút "Mua ngay với mã" mở trang sản phẩm kèm state { applyCoupon }. Mã chỉ áp được khi món đã nằm trong giỏ
// (mã gắn sản phẩm, có đơn tối thiểu), nên trang áp mã SAU khi thêm giỏ hay mua ngay thành công.

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

function renderPdp(state: Record<string, unknown> | null = { applyCoupon: CODE, variationId: 'v1' }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
const addBtn = () => screen.findByRole('button', { name: 'Thêm vào giỏ' });
const buyBtn = () => screen.findByRole('button', { name: /^Mua ngay/ });
const snackbars = () => mocks.openSnackbar.mock.calls.map((c) => c[0] as { text: string; type: string });

describe('ProductDetailPage — áp mã mua chung sau khi thêm giỏ (E-9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProduct.mockResolvedValue(PRODUCT);
    mocks.addToCart.mockResolvedValue(cart());
    mocks.applyCoupon.mockResolvedValue(cart({ couponCode: CODE, discount: 15_000 }));
  });

  it('thêm giỏ xong thì áp đúng mã vào giỏ và báo "Đã áp mã"', async () => {
    renderPdp();
    fireEvent.click(await addBtn());
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledWith(CODE));
    expect(mocks.addToCart.mock.invocationCallOrder[0]!).toBeLessThan(mocks.applyCoupon.mock.invocationCallOrder[0]!);
    await waitFor(() => expect(snackbars().some((s) => s.type === 'success' && s.text.includes(`Đã áp mã ${CODE}`))).toBe(true));
  });

  it('mua ngay: áp mã xong mới sang thanh toán, chỉ chọn đúng dòng vừa thêm', async () => {
    renderPdp();
    fireEvent.click(await buyBtn());
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/checkout', { state: { itemIds: ['line1'] } }));
    expect(mocks.applyCoupon).toHaveBeenCalledWith(CODE);
    const checkoutAt = mocks.navigate.mock.calls.findIndex((c) => c[0] === '/checkout');
    expect(mocks.applyCoupon.mock.invocationCallOrder[0]!).toBeLessThan(mocks.navigate.mock.invocationCallOrder[checkoutAt]!);
  });

  it('áp mã lỗi: món vẫn vào giỏ, toast nói lời máy chủ, không chặn mua ngay', async () => {
    mocks.applyCoupon.mockRejectedValue(new Error('Đơn chưa đạt mức tối thiểu của mã'));
    renderPdp();
    fireEvent.click(await buyBtn());
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/checkout', { state: { itemIds: ['line1'] } }));
    expect(snackbars().some((s) => s.text.includes('Đơn chưa đạt mức tối thiểu của mã'))).toBe(true);
  });

  it('thêm giỏ + áp mã lỗi: vẫn báo đã thêm giỏ kèm lý do chưa áp được mã', async () => {
    mocks.applyCoupon.mockRejectedValue(new Error('Mã đã hết hạn'));
    renderPdp();
    fireEvent.click(await addBtn());
    await waitFor(() => expect(snackbars().some((s) => s.text.includes('Mã đã hết hạn'))).toBe(true));
    const last = snackbars().find((s) => s.text.includes('Mã đã hết hạn'))!;
    expect(last.text).toContain('Đã thêm vào giỏ');
    expect(last.type).not.toBe('error');
  });

  it('máy chủ giữ mã nhưng chưa tính giảm (đơn tối thiểu): nói lý do thay vì báo đã áp', async () => {
    mocks.applyCoupon.mockResolvedValue(cart({ couponCode: CODE, discount: 0, couponNotice: 'Cần thêm 20.000đ để dùng mã' }));
    renderPdp();
    fireEvent.click(await addBtn());
    await waitFor(() => expect(snackbars().some((s) => s.text.includes('Cần thêm 20.000đ để dùng mã'))).toBe(true));
    expect(snackbars().some((s) => s.text.includes('Đã áp mã'))).toBe(false);
  });

  it('chỉ áp một lần mỗi lần mở trang: thêm giỏ lần hai không áp lại (khách có thể đã bỏ chọn mã ở giỏ)', async () => {
    renderPdp();
    fireEvent.click(await addBtn());
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    fireEvent.click(await addBtn());
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(1);
  });

  it('áp xong thì gỡ mã khỏi state của mục lịch sử, giữ phân loại: quay lại trang không áp lại', async () => {
    renderPdp();
    fireEvent.click(await addBtn());
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/product/xa-phong', { replace: true, state: { variationId: 'v1' } }),
    );
  });

  it('mở trang không kèm mã (lối vào thường): không gọi applyCoupon', async () => {
    renderPdp({ variationId: 'v1' });
    fireEvent.click(await addBtn());
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalled());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã thêm vào giỏ 🌿' })));
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
  });

  it('thêm giỏ lỗi (hết hàng...): không áp mã', async () => {
    mocks.addToCart.mockRejectedValue(new Error('Chỉ còn 0 sản phẩm'));
    renderPdp();
    fireEvent.click(await addBtn());
    await waitFor(() => expect(snackbars().some((s) => s.type === 'error')).toBe(true));
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
  });
});
