import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Nhãn tồn kho thông minh ở trang chi tiết (Wave 8): 1–20 "Chỉ còn N sản phẩm" (cảnh báo), 21–99.999 "Còn hàng", từ 100.000 "Còn hàng — Sẵn sàng giao ngay".

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
  getCart: vi.fn().mockResolvedValue({ items: [], itemCount: 0 }),
  addToCart: vi.fn(),
  applyCoupon: vi.fn(),
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
const productWith = (stock: number) => ({
  id: 'p1', slug: 'xa-phong', brand: 'Cô Lan', name: 'Xà phòng sả chanh', shortDesc: null, description: 'Mô tả',
  images: [], thumbnail: null, basePrice: 100_000, salePrice: null, certifications: [], ingredients: null, sold: 0,
  variations: [{ id: 'v1', sku: 'S1', name: 'Mặc định', attributes: {}, retailPrice: 100_000, salePrice: null, stock }],
});

async function openPdp(stock: number) {
  mocks.fetchProduct.mockResolvedValue(productWith(stock));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: '/product/xa-phong', state: { variationId: 'v1' } }]} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
}

describe('ProductDetailPage: nhãn tồn kho thông minh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tồn 1–20: "Chỉ còn N sản phẩm" màu cảnh báo (testid pdp-low-stock)', async () => {
    await openPdp(7);
    const note = await screen.findByTestId('pdp-low-stock');
    expect(note).toHaveTextContent(/^Chỉ còn 7 sản phẩm$/);
    expect(note.getAttribute('style')).toContain('--color-text-warning');
    expect(screen.queryByTestId('pdp-stock-label')).toBeNull();
  });

  it('tồn 21–99.999: "Còn hàng" màu phụ, không có số', async () => {
    await openPdp(245);
    const note = await screen.findByTestId('pdp-stock-label');
    expect(note).toHaveTextContent(/^Còn hàng$/);
    expect(note.getAttribute('style')).toContain('--color-text-secondary');
    expect(note.getAttribute('style')).not.toContain('--color-text-warning');
    expect(screen.queryByTestId('pdp-low-stock')).toBeNull();
  });

  it('tồn ảo 99.999.988 (Pancake): "Còn hàng — Sẵn sàng giao ngay", không lộ con số nào trên cả trang', async () => {
    await openPdp(99_999_988);
    const note = await screen.findByTestId('pdp-stock-label');
    expect(note).toHaveTextContent(/^Còn hàng — Sẵn sàng giao ngay$/);
    expect(document.body.textContent).not.toMatch(/99\.?999\.?988/);
  });

  it('hết hàng: không có dòng tồn kho (nút mua đã ghi "Tạm hết hàng")', async () => {
    await openPdp(0);
    await screen.findByText('Xà phòng sả chanh');
    expect(screen.queryByTestId('pdp-low-stock')).toBeNull();
    expect(screen.queryByTestId('pdp-stock-label')).toBeNull();
  });
});
