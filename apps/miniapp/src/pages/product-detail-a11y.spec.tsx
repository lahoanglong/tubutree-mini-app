import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  fetchRelated: vi.fn(),
  fetchBoughtTogether: vi.fn(),
  fetchReviews: vi.fn(),
  getCoupons: vi.fn(),
  copyText: vi.fn(),
  openSnackbar: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar }),
  useNavigate: () => vi.fn(),
}));
vi.mock('../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  fetchRelated: mocks.fetchRelated,
  fetchBoughtTogether: mocks.fetchBoughtTogether,
  fetchReviews: mocks.fetchReviews,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn().mockResolvedValue({ items: [], itemCount: 0 }),
  addToCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getCoupons: mocks.getCoupons }));
vi.mock('../services/groupbuy-api', () => ({ createGroupBuy: vi.fn() }));
vi.mock('../services/affiliate-api', () => ({ getAffiliateMe: vi.fn().mockResolvedValue({ isAffiliate: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: vi.fn() }));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', login: vi.fn() };
  return { useAuthStore: Object.assign(() => state, { getState: () => state }) };
});
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: 0.1 }) }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../components/reviews-section', () => ({ ReviewsSection: () => null, Stars: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/subscribe-sheet', () => ({ SubscribeSheet: () => null }));
vi.mock('../components/content-kit-sheet', () => ({ ContentKitSheet: () => null }));
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/ui/cart-badge', () => ({ CartBadge: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import ProductDetailPage from './product-detail';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const variation = { id: 'v1', sku: 'SKU1', name: 'Mặc định', attributes: {}, retailPrice: 100000, salePrice: null, stock: 5 };
const product = (over: Record<string, unknown> = {}) => ({
  id: 'id-a', slug: 'a', brand: 'Tubu', name: 'Mật ong rừng', shortDesc: null, description: 'Mô tả',
  images: ['https://img/1.jpg', 'https://img/2.jpg', 'https://img/3.jpg'], thumbnail: 'https://img/thumb.jpg',
  basePrice: 100000, salePrice: 80000, certifications: [], ingredients: null, sold: 0, variations: [variation], ...over,
});
const COUPONS = [
  { code: 'GIAM10', type: 'PERCENT', value: 10, minOrder: null, maxDiscount: null, endAt: '2026-12-31T00:00:00.000Z' },
  { code: 'FREESHIP', type: 'FREESHIP', value: 0, minOrder: 200000, maxDiscount: null, endAt: '2026-12-31T00:00:00.000Z' },
];

/** jsdom không có layout: giả lập vùng cuộn rộng 1170 trong khung 390. */
function mockOverflow(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth });
}

function renderPdp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/product/a']} future={FUTURE}>
        <Routes>
          <Route path="/product/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.fetchProduct.mockResolvedValue(product());
  mocks.fetchRelated.mockResolvedValue([]);
  mocks.fetchBoughtTogether.mockResolvedValue([]);
  mocks.fetchReviews.mockResolvedValue({ data: [], summary: { average: 0, count: 0 } });
  mocks.getCoupons.mockResolvedValue(COUPONS);
  mocks.copyText.mockResolvedValue(true);
});

afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
});

describe('Chi tiết sản phẩm — ngữ nghĩa trang (C-114)', () => {
  it('có đúng một h1 và nó là tên sản phẩm (trang không dùng PageHeader)', async () => {
    renderPdp();
    await screen.findByText('Mật ong rừng');
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent('Mật ong rừng');
  });

  it('đang tải: đúng một h1 (tiêu đề ẩn vì chưa có tên sản phẩm)', async () => {
    mocks.fetchProduct.mockReturnValue(new Promise(() => {}));
    const { container } = renderPdp();
    await waitFor(() => expect(container.querySelector('.zaui-page')).not.toBeNull());
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent('Chi tiết sản phẩm');
  });

  it('lỗi tải: đúng một h1 cạnh khối báo lỗi', async () => {
    mocks.fetchProduct.mockRejectedValue(new Error('boom'));
    renderPdp();
    await screen.findByRole('button', { name: /thử lại/i });
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent('Chi tiết sản phẩm');
  });

  it('không thấy sản phẩm (API trả rỗng): đúng một h1', async () => {
    mocks.fetchProduct.mockResolvedValue(null);
    renderPdp();
    await screen.findByRole('button', { name: /thử lại/i });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('Chi tiết sản phẩm — vùng cuộn ngang focus được (axe scrollable-region-focusable)', () => {
  it('thư viện ảnh nhiều ảnh là vùng có tên, tràn ngang mà không có gì bấm được bên trong → focus được bằng bàn phím', async () => {
    mockOverflow(1170, 390);
    renderPdp();
    const gallery = await screen.findByRole('region', { name: 'Ảnh sản phẩm' });
    expect(within(gallery).getAllByRole('img')).toHaveLength(3);
    expect(gallery).toHaveAttribute('tabindex', '0');
  });

  it('thư viện ảnh không tràn (một ảnh) → không thêm điểm dừng Tab thừa', async () => {
    mocks.fetchProduct.mockResolvedValue(product({ images: ['https://img/1.jpg'] }));
    renderPdp();
    const gallery = await screen.findByRole('region', { name: 'Ảnh sản phẩm' });
    expect(gallery).not.toHaveAttribute('tabindex');
  });

  it('hàng mã giảm giá là vùng cuộn có tên; mỗi mã là nút Tab tới được', async () => {
    mockOverflow(1012, 358);
    renderPdp();
    const row = await screen.findByRole('region', { name: 'Mã giảm giá có thể dùng' });
    expect(row.className).toContain('scroll-x');
    const chips = within(row).getAllByRole('button');
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual(['Sao chép mã GIAM10', 'Sao chép mã FREESHIP']);
    for (const c of chips) expect(c.tabIndex).toBe(0);
    // Bên trong đã có nút focus được nên hàng không thêm điểm dừng Tab riêng.
    expect(row).not.toHaveAttribute('tabindex');
  });

  it('Enter và Space trên một mã sao chép đúng mã đó (bàn phím dùng được như chạm)', async () => {
    const user = userEvent.setup();
    renderPdp();
    const chip = await screen.findByRole('button', { name: 'Sao chép mã GIAM10' });
    chip.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('GIAM10'));
    await user.keyboard(' ');
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(2));
  });
});
