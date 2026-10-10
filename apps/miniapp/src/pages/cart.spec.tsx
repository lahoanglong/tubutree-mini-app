import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getCart: vi.fn(),
  removeCartItem: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/cart', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  getCart: mocks.getCart,
  removeCartItem: mocks.removeCartItem,
  updateCartItem: vi.fn(),
  addToCart: vi.fn(),
}));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated' };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/checkout/voucher-sheet', () => ({ VoucherSheet: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import CartPage from './cart';

const GONE = {
  id: 'ci-gone',
  variationId: 'v-gone',
  productName: 'Nước rửa chén cũ',
  variationName: 'Chanh',
  slug: 'nrc-cu',
  thumbnail: null,
  quantity: 2,
};
const OK_LINE = {
  id: 'ci-ok',
  variationId: 'v-ok',
  productName: 'Xà bông thảo mộc',
  variationName: 'Sả',
  slug: 'xb',
  thumbnail: null,
  unitPrice: 50_000,
  quantity: 1,
  stock: 5,
  total: 50_000,
};
const summary = (over: object) => ({
  items: [OK_LINE],
  couponCode: null,
  subtotal: 50_000,
  discount: 0,
  freeship: false,
  freeshipThreshold: 200_000,
  itemCount: 1,
  unavailableItems: [],
  ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CartPage />
    </QueryClientProvider>,
  );
}

describe('CartPage — SP đã ngừng bán (C-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('giỏ có dòng ngừng bán → báo "đã ngừng bán" kèm tên SP; bấm Xoá gỡ dòng đó', async () => {
    mocks.getCart.mockResolvedValue(summary({ unavailableItems: [GONE] }));
    mocks.removeCartItem.mockResolvedValue(summary({ unavailableItems: [] }));
    renderPage();
    expect(await screen.findByText('1 sản phẩm đã ngừng bán')).toBeInTheDocument();
    expect(screen.getByText(/Nước rửa chén cũ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(mocks.removeCartItem).toHaveBeenCalledWith('ci-gone'));
    await waitFor(() => expect(screen.queryByText('1 sản phẩm đã ngừng bán')).toBeNull());
  });

  it('giỏ chỉ còn dòng ngừng bán → vẫn báo, cùng màn giỏ trống', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [], subtotal: 0, itemCount: 0, unavailableItems: [GONE] }));
    renderPage();
    expect(await screen.findByText('1 sản phẩm đã ngừng bán')).toBeInTheDocument();
    expect(screen.getByText('Giỏ còn trống đấy')).toBeInTheDocument();
  });

  it('không có dòng ngừng bán (hoặc API cũ thiếu trường) → không hiện thông báo', async () => {
    const { unavailableItems: _drop, ...legacy } = summary({});
    mocks.getCart.mockResolvedValue(legacy);
    renderPage();
    expect(await screen.findByText('Xà bông thảo mộc')).toBeInTheDocument();
    expect(screen.queryByText(/đã ngừng bán/)).toBeNull();
  });
});

describe('CartPage — vùng chạm >= 44px (C-021)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCart.mockResolvedValue(summary({}));
  });

  it('tên sản phẩm bấm được mở trang sản phẩm và có vùng chạm 44px (tubu-hit-44, hiện block cho trọn bề ngang)', async () => {
    renderPage();
    const name = await screen.findByText('Xà bông thảo mộc');
    expect(name.className).toContain('tubu-hit-44');
    expect(name.style.display).toBe('block');
    fireEvent.click(name);
    expect(mocks.navigate).toHaveBeenCalledWith('/product/xb');
  });

  it('nút "Hoàn tác" sau khi xoá có vùng chạm 44px', async () => {
    mocks.removeCartItem.mockResolvedValue(summary({ items: [], subtotal: 0, itemCount: 0 }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá Xà bông thảo mộc' }));
    const undo = await screen.findByRole('button', { name: 'Hoàn tác' });
    expect(undo.className).toContain('tubu-hit-44');
  });

  it('nút tăng/giảm số lượng vuông tối thiểu 44x44 (trước đây 36x36)', async () => {
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    for (const name of ['Giảm số lượng', 'Tăng số lượng']) {
      const btn = screen.getByRole('button', { name });
      expect(Number.parseFloat(btn.style.width)).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(btn.style.height)).toBeGreaterThanOrEqual(44);
    }
  });
});
