import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PublicConfigModule from '../hooks/use-public-config';
import type * as RefillApiModule from '@tubutree/app-core/refill/refill-api';

const mocks = vi.hoisted(() => ({
  on: true,
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getCart: vi.fn(),
  getCartSelection: vi.fn(),
  removeCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  addToCart: vi.fn(),
  pairs: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/cart', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  getAddresses: vi.fn().mockResolvedValue([]),
  getCart: mocks.getCart,
  getCartSelection: mocks.getCartSelection,
  removeCartItem: mocks.removeCartItem,
  updateCartItem: mocks.updateCartItem,
  addToCart: mocks.addToCart,
  fetchProducts: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 4, total: 0 } }),
  getCouponPreviews: vi.fn().mockResolvedValue([]),
  applyCoupon: vi.fn(),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/account-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCoupons: vi.fn().mockResolvedValue([]),
}));
vi.mock('../hooks/use-public-config', async (importOriginal) => {
  const real = await importOriginal<typeof PublicConfigModule>();
  return { ...real, usePublicConfig: () => ({ ...real.PUBLIC_CONFIG_FALLBACK, refillFirstEnabled: mocks.on, isLoaded: true, isPending: false }) };
});
vi.mock('@tubutree/app-core/refill/refill-api', async (importOriginal) => ({
  ...(await importOriginal<typeof RefillApiModule>()),
  myRefillPairsQuery: (_http: unknown, ids: readonly string[]) => ({
    queryKey: ['refill-pairs', 'mine', ids.join(',')],
    queryFn: () => mocks.pairs(ids),
    retry: false,
  }),
}));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated' };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/checkout/voucher-sheet', () => ({ VoucherSheet: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/checkout/use-shipping-estimate', () => ({ useShippingEstimate: () => ({ estimate: undefined, stale: false }) }));
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn(), setCheckoutEntry: vi.fn() }));

import CartPage from './cart';
import { trackEvent } from '../services/analytics';

const BOTTLE = {
  id: 'ci-bottle',
  productId: 'p-bottle',
  variationId: 'v-bottle',
  productName: 'Nước rửa chén Fuwa3e 500ml',
  variationName: null,
  slug: 'nrc-500',
  thumbnail: null,
  unitPrice: 60_000,
  quantity: 2,
  stock: 9,
  total: 120_000,
};
const REFILL_LINE = { ...BOTTLE, id: 'ci-refill', productId: 'p-refill', variationId: 'v-refill', productName: 'Nước rửa chén Fuwa3e 10L', slug: 'nrc-10l', unitPrice: 650_000, quantity: 1, total: 650_000 };
const OFFER = { productId: 'p-refill', slug: 'nrc-10l', name: 'Nước rửa chén Fuwa3e 10L', thumbnail: null, variationId: 'v-refill', price: 650_000, compareAt: null, sizeLabel: '10L', inStock: true, tubu: true };
const summary = (items: object[]) => ({
  items,
  couponCode: null,
  subtotal: items.reduce((s, it) => s + (it as { total: number }).total, 0),
  discount: 0,
  freeship: false,
  freeshipThreshold: 199_000,
  itemCount: items.length,
  unavailableItems: [],
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CartPage />
    </QueryClientProvider>,
  );
}

const link = () => screen.queryByTestId('refill-swap-link');

describe('Giỏ Mini: đổi dòng chai sang gói Refill (catalog.refill_first_enabled)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.on = true;
    mocks.getCart.mockResolvedValue(summary([BOTTLE]));
    mocks.pairs.mockResolvedValue({ 'p-bottle': OFFER });
  });

  it('cờ tắt: không hỏi cặp refill, không có liên kết (hành vi cũ)', async () => {
    mocks.on = false;
    renderPage();
    expect(await screen.findByText('Nước rửa chén Fuwa3e 500ml')).toBeInTheDocument();
    await act(async () => undefined);
    expect(mocks.pairs).not.toHaveBeenCalled();
    expect(link()).toBeNull();
  });

  it('liên kết chữ dưới dòng chai ghi giá gói và phần tăng; chạm mở hộp xác nhận, xác nhận thì thêm gói rồi mới bỏ chai; Hoàn tác trả lại đúng chai', async () => {
    renderPage();
    await waitFor(() => expect(link()).not.toBeNull());
    expect(mocks.pairs).toHaveBeenCalledWith(['p-bottle']);
    expect(link()!.textContent).toBe('Đã có chai? Đổi sang Refill 10L · 650.000đ (+530.000đ) Tiết kiệm 550.000đ');
    expect(screen.getByText('Tiết kiệm 550.000đ').style.fontVariantNumeric).toBe('tabular-nums');
    // Chạm lần đầu mở hộp xác nhận: trình đọc màn hình biết trước (như web).
    expect(link()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trackEvent).toHaveBeenCalledWith('refill_swap_shown', 'miniapp', { surface: 'cart' });

    fireEvent.click(link()!);
    expect(await screen.findByText('Đổi sang Refill?')).toBeInTheDocument();
    // Mốc lấy đúng ngưỡng giỏ máy chủ trả (freeshipThreshold 199.000đ của cấu hình), cùng số với thanh mốc của giỏ.
    expect(document.body.textContent).toContain('Dòng này tăng 530.000đ. Tiết kiệm 550.000đ so với mua chai cùng lượng. Giỏ sẽ đủ Miễn phí giao hàng.');
    expect(mocks.addToCart).not.toHaveBeenCalled();

    const order: string[] = [];
    mocks.addToCart.mockImplementation(async (v: string) => {
      order.push(`add:${v}`);
      return summary([BOTTLE, REFILL_LINE]);
    });
    mocks.removeCartItem.mockImplementation(async (id: string) => {
      order.push(`remove:${id}`);
      return summary([REFILL_LINE]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đổi sang Refill' }));
    expect(await screen.findByText('Đã đổi sang Refill')).toBeInTheDocument();
    expect(order).toEqual(['add:v-refill', 'remove:ci-bottle']);
    expect(trackEvent).toHaveBeenCalledWith('refill_swap_applied', 'miniapp', { surface: 'cart' });

    order.length = 0;
    mocks.addToCart.mockImplementation(async (v: string, q: number) => {
      order.push(`add:${v}x${q}`);
      return summary([REFILL_LINE, BOTTLE]);
    });
    mocks.removeCartItem.mockImplementation(async (id: string) => {
      order.push(`remove:${id}`);
      return summary([BOTTLE]);
    });
    fireEvent.click(screen.getByText('Hoàn tác'));
    await waitFor(() => expect(order).toEqual(['add:v-bottlex2', 'remove:ci-refill']));
    expect(trackEvent).toHaveBeenCalledWith('refill_swap_undone', 'miniapp', { surface: 'cart' });
  });

  it('gói refill hết hàng: không mời đổi', async () => {
    mocks.pairs.mockResolvedValue({ 'p-bottle': { ...OFFER, inStock: false } });
    renderPage();
    expect(await screen.findByText('Nước rửa chén Fuwa3e 500ml')).toBeInTheDocument();
    await waitFor(() => expect(mocks.pairs).toHaveBeenCalled());
    await act(async () => undefined);
    expect(link()).toBeNull();
  });

  it('gói rẻ hơn dòng chai và không mất mốc: đổi ngay một chạm, không hộp xác nhận', async () => {
    mocks.getCart.mockResolvedValue(summary([{ ...BOTTLE, quantity: 12, total: 720_000 }]));
    mocks.addToCart.mockResolvedValue(summary([{ ...BOTTLE, quantity: 12, total: 720_000 }, REFILL_LINE]));
    mocks.removeCartItem.mockResolvedValue(summary([REFILL_LINE]));
    renderPage();
    await waitFor(() => expect(link()).not.toBeNull());
    expect(link()!.textContent).toBe('Đã có chai? Đổi sang Refill 10L · 650.000đ Tiết kiệm 550.000đ');
    expect(link()).not.toHaveAttribute('aria-haspopup');
    fireEvent.click(link()!);
    expect(await screen.findByText('Đã đổi sang Refill')).toBeInTheDocument();
    expect(screen.queryByText('Đổi sang Refill?')).toBeNull();
    expect(mocks.addToCart).toHaveBeenCalledWith('v-refill', 1);
    expect(mocks.removeCartItem).toHaveBeenCalledWith('ci-bottle');
  });

  it('gói Refill do gian hàng tự giao không bao giờ góp vào mốc Miễn phí giao hàng của Tubu: hộp xác nhận không hứa "Giỏ sẽ đủ"', async () => {
    mocks.pairs.mockResolvedValue({ 'p-bottle': { ...OFFER, tubu: false } });
    renderPage();
    await waitFor(() => expect(link()).not.toBeNull());
    fireEvent.click(link()!);
    expect(await screen.findByText('Đổi sang Refill?')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Dòng này tăng 530.000đ.');
    expect(document.body.textContent).not.toContain('Giỏ sẽ đủ Miễn phí giao hàng');
  });

  it('đổi làm giỏ rơi dưới mốc Miễn phí giao hàng: hộp xác nhận nói trước số còn thiếu', async () => {
    const big = { ...BOTTLE, quantity: 5, total: 300_000 };
    mocks.getCart.mockResolvedValue(summary([big]));
    mocks.pairs.mockResolvedValue({ 'p-bottle': { ...OFFER, price: 150_000 } });
    renderPage();
    await waitFor(() => expect(link()).not.toBeNull());
    fireEvent.click(link()!);
    expect(await screen.findByText('Đổi sang Refill?')).toBeInTheDocument();
    expect(screen.getByText(/Giỏ sẽ thiếu 49\.000đ để Miễn phí giao hàng/)).toBeInTheDocument();
  });
});
