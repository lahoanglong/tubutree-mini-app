import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phân loại không đặt tên (86/154 phân loại trên PROD): dòng giỏ không dựng dòng phân loại trống, danh sách "đã ngừng bán" không treo dấu " · ".

const mocks = vi.hoisted(() => ({ getCart: vi.fn(), getCartSelection: vi.fn(), getCouponPreviews: vi.fn(), getCoupons: vi.fn().mockResolvedValue([]), fetchProducts: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/cart', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  getCart: mocks.getCart,
  getCartSelection: mocks.getCartSelection,
  removeCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  addToCart: vi.fn(),
  fetchProducts: mocks.fetchProducts,
  getCouponPreviews: mocks.getCouponPreviews,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/account-api', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), getCoupons: mocks.getCoupons }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated' };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/checkout/voucher-sheet', () => ({ VoucherSheet: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import CartPage from './cart';

const line = (variationName: string, over: object = {}) => ({
  id: 'ci-ok', variationId: 'v-ok', productName: 'Xà bông thảo mộc', variationName, slug: 'xb', thumbnail: null, unitPrice: 50_000, quantity: 1, stock: 5, total: 50_000, ...over,
});
const gone = (id: string, productName: string, variationName: string, quantity: number) => ({ id, variationId: `v-${id}`, productName, variationName, slug: id, thumbnail: null, quantity });
const summary = (items: unknown[], unavailableItems: unknown[] = []) => ({
  items, couponCode: null, subtotal: 50_000, discount: 0, freeship: false, freeshipThreshold: 200_000, itemCount: items.length, unavailableItems,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CartPage />
    </QueryClientProvider>,
  );
}

describe('CartPage Mini — phân loại không có tên', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCartSelection.mockRejectedValue(new Error('chưa mock'));
    mocks.getCouponPreviews.mockResolvedValue([]);
    mocks.getCoupons.mockResolvedValue([]);
    mocks.fetchProducts.mockResolvedValue({ data: [], meta: { page: 1, limit: 4, total: 0 } });
  });

  it('có tên: dòng phân loại hiện dưới tên sản phẩm như trước', async () => {
    mocks.getCart.mockResolvedValue(summary([line('Sả')]));
    renderPage();
    const row = await screen.findByTestId('cart-line');
    expect(within(row).getByText('Sả')).toBeInTheDocument();
  });

  it('tên trống hoặc toàn khoảng trắng: không dựng dòng phân loại (cột chữ ít đúng một khối so với dòng có tên)', async () => {
    const columnTexts = async (name: string) => {
      mocks.getCart.mockResolvedValue(summary([line(name)]));
      const { unmount } = renderPage();
      const row = await screen.findByTestId('cart-line');
      const column = within(row).getByText('Xà bông thảo mộc').parentElement!.parentElement!;
      const texts = Array.from(column.children).map((n) => n.textContent);
      unmount();
      return texts;
    };
    const named = await columnTexts('Sả');
    expect(named[1]).toBe('Sả');
    for (const name of ['', '   ']) {
      const blank = await columnTexts(name);
      expect(blank).toHaveLength(named.length - 1);
      expect(blank).toEqual([named[0], ...named.slice(2)]);
    }
  });

  it('danh sách "đã ngừng bán": tên trống thì chỉ "Tên × SL", không " · " treo; có tên giữ "Tên · phân loại × SL"', async () => {
    mocks.getCart.mockResolvedValue(summary([line('Sả')], [gone('g1', 'Nước rửa chén cũ', '', 2), gone('g2', 'Dầu xả cũ', '  ', 1), gone('g3', 'Sữa tắm cũ', '250ml', 3)]));
    renderPage();
    await screen.findByText('3 sản phẩm đã ngừng bán');
    const texts = Array.from(document.querySelectorAll<HTMLElement>('[style*="line-through"]')).map((n) => n.textContent);
    expect(texts).toEqual(['Nước rửa chén cũ × 2', 'Dầu xả cũ × 1', 'Sữa tắm cũ · 250ml × 3']);
  });
});
