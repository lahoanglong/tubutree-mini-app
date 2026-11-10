import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getCart: vi.fn(),
  getCartSelection: vi.fn(),
  removeCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  voucherProps: [] as Record<string, unknown>[],
  fetchProducts: vi.fn(),
  addToCart: vi.fn(),
  getCouponPreviews: vi.fn(),
  getCoupons: vi.fn().mockResolvedValue([]),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/cart', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  getCart: mocks.getCart,
  getCartSelection: mocks.getCartSelection,
  removeCartItem: mocks.removeCartItem,
  updateCartItem: mocks.updateCartItem,
  addToCart: mocks.addToCart,
  fetchProducts: mocks.fetchProducts,
  getCouponPreviews: mocks.getCouponPreviews,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/account-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCoupons: mocks.getCoupons,
}));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated' };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../components/storefront-context-bar', () => ({ StorefrontContextBar: () => null }));
vi.mock('../components/checkout/voucher-sheet', () => ({
  VoucherSheet: (p: Record<string, unknown>) => {
    mocks.voucherProps.push(p);
    return <div data-testid="voucher-sheet" data-visible={String(p.visible)} />;
  },
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import CartPage from './cart';
import { useStorefrontContext } from '../store/storefront-context';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

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

  it('giỏ trống: dưới lời mời mua sắm có kệ "Có thể bạn thích"; giỏ có hàng thì không có', async () => {
    mocks.fetchProducts.mockResolvedValue({
      data: [{ id: 'g1', slug: 'g1', brand: 'Tubu', name: 'Gợi ý một', thumbnail: null, basePrice: 90_000, salePrice: null, isFeatured: false, inStock: true }],
      meta: { page: 1, limit: 4, total: 1 },
    });
    mocks.getCart.mockResolvedValue(summary({ items: [], subtotal: 0, itemCount: 0 }));
    const empty = renderPage();
    expect(await screen.findByText('Giỏ còn trống đấy')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Có thể bạn thích' })).toBeInTheDocument();
    expect(screen.getByText('Gợi ý một')).toBeInTheDocument();
    empty.unmount();
    mocks.getCart.mockResolvedValue(summary({}));
    renderPage();
    expect(await screen.findByText('Xà bông thảo mộc')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Có thể bạn thích' })).toBeNull();
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

  it('nút tăng/giảm số lượng nhìn 36px (size sm của dòng gọn) nhưng vùng chạm vẫn 44x44 qua tubu-hit-44-square', async () => {
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    for (const name of ['Giảm số lượng', 'Tăng số lượng']) {
      const btn = screen.getByRole('button', { name });
      expect(Number.parseFloat(btn.style.width)).toBeGreaterThanOrEqual(36);
      expect(btn.className).toContain('tubu-hit-44-square');
    }
  });
});

describe('CartPage — vượt tồn kho (BUYERMINI-18) và suất giờ vàng (ENGAGE-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dòng đang chọn có số lượng vượt tồn → nút Thanh toán bị khoá, kèm hướng dẫn giảm số lượng', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 3, stock: 1, total: 150_000 }] }));
    renderPage();
    expect(await screen.findByText('Chỉ còn 1 sản phẩm')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Thanh toán (3)' });
    expect(btn).toBeDisabled();
    expect(screen.getByText('Giảm số lượng sản phẩm vượt tồn kho để thanh toán.')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(mocks.navigate).not.toHaveBeenCalledWith('/checkout', expect.anything());
  });

  it('tồn cao (40) mà đã chọn 40: không có dòng tồn kho, nút + vẫn bấm được (khoá ở 40 là lộ tồn thật, Smart Stock)', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 40, stock: 40, total: 2_000_000 }] }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.queryByText(/hàng đang có/)).toBeNull();
    expect(screen.queryByText(/Còn 40 sản phẩm/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toHaveAttribute('aria-disabled', 'false');
  });

  it('tồn cao: nút + dừng ở trần cố định 99, không ở tồn', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 99, stock: 500, total: 4_950_000 }] }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('vượt tồn mà tồn cao (50 trên tồn 40): dòng báo "Vượt số hàng đang có…", cảnh báo, không ghi số tồn; nút − về 20, không về sát tồn', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 50, stock: 40, total: 2_500_000 }] }));
    mocks.updateCartItem.mockReturnValue(new Promise(() => undefined));
    renderPage();
    const note = await screen.findByText('Vượt số hàng đang có, giảm bớt để thanh toán');
    expect(note.getAttribute('style')).toContain('--color-text-warning');
    expect(screen.queryByText(/Còn 40 sản phẩm/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Giảm số lượng' }));
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledWith(OK_LINE.id, 20), { timeout: 2_000 });
    await waitFor(() => expect(screen.queryByText('Vượt số hàng đang có, giảm bớt để thanh toán')).toBeNull());
    expect(mocks.updateCartItem).not.toHaveBeenCalledWith(OK_LINE.id, 40);
  });

  it('chạm trần mà tồn thấp (3/3): cảnh báo kèm icon; chưa chạm trần (2/40) không có dòng (L5 3)', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 3, stock: 3, total: 150_000 }] }));
    const low = renderPage();
    const note = await screen.findByText('Chỉ còn 3 sản phẩm');
    expect(note.getAttribute('style')).toContain('--color-text-warning');
    expect(note.parentElement!.querySelector('svg')).not.toBeNull();
    low.unmount();
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 2, stock: 40, total: 100_000 }] }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.queryByText(/^(?:Chỉ còn|Còn) \d+ sản phẩm$/)).toBeNull();
  });

  it('bấm + tới trần tồn thấp: dòng tồn kho hiện cùng lúc nút + khoá, không đợi máy chủ (L5 3)', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 4, stock: 5, total: 200_000 }] }));
    mocks.updateCartItem.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.queryByText('Chỉ còn 5 sản phẩm')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    expect(screen.getByText('Chỉ còn 5 sản phẩm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('bấm + qua tồn cao (40 → 41): nút + không khoá ở 40, máy chủ là nơi từ chối', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 39, stock: 40, total: 1_950_000 }] }));
    mocks.updateCartItem.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    const plus = screen.getByRole('button', { name: 'Tăng số lượng' });
    fireEvent.click(plus);
    expect(plus).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(plus);
    // Số trên màn vượt tồn nhưng máy chủ chưa nhận: không báo "vượt" ngay trên máy (báo là đọc ra tồn thật mà không cần hỏi máy chủ).
    expect(screen.queryByText('Vượt số hàng đang có, giảm bớt để thanh toán')).toBeNull();
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledWith(OK_LINE.id, 41), { timeout: 2_000 });
  });

  it('hết hàng hẳn → báo hết hàng thay vì "Còn 0 sản phẩm"', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 1, stock: 0 }] }));
    renderPage();
    expect(await screen.findByText('Sản phẩm đã hết hàng')).toBeInTheDocument();
    expect(screen.queryByText('Còn 0 sản phẩm')).toBeNull();
  });

  it('hết hàng hẳn mà SL ≥ 2: cả − lẫn + đều khoá (không gửi SL 1 vào chỗ còn 0), nút Xoá vẫn còn', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 3, stock: 0 }] }));
    renderPage();
    await screen.findByText('Sản phẩm đã hết hàng');
    expect(screen.getByRole('button', { name: 'Giảm số lượng' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Giảm số lượng' }));
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Xoá ${OK_LINE.productName}` })).toBeInTheDocument();
  });

  it('vượt tồn nhưng còn hàng (SL 3, tồn 2): nút − vẫn dùng được', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 3, stock: 2 }] }));
    renderPage();
    const minus = await screen.findByRole('button', { name: 'Giảm số lượng' });
    expect(minus).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(minus);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  describe('dòng hết hàng (tồn 0) đang chọn', () => {
    const OOS = { ...OK_LINE, id: 'ci-oos', variationId: 'v-oos', productName: 'Cobote bột giặt', unitPrice: 79_000, quantity: 2, stock: 0, total: 158_000 };
    const BUYABLE = { ...OK_LINE, id: 'ci-buy', variationId: 'v-buy', productName: 'Cà phê hoà tan', unitPrice: 75_000, quantity: 1, stock: 5, total: 75_000 };

    it('Tạm tính và thanh miễn phí giao chỉ tính phần mua được: không cộng dòng hết hàng', async () => {
      mocks.getCart.mockResolvedValue(summary({ items: [OOS, BUYABLE], subtotal: 233_000, itemCount: 3 }));
      renderPage();
      await screen.findByText('Cobote bột giặt');
      expect(screen.getByText('Mua thêm 125.000đ để được Miễn phí giao hàng 🚚')).toBeInTheDocument();
      expect(screen.queryByText('🎉 Đơn hàng đã được Miễn phí giao hàng')).toBeNull();
      expect(screen.getByText('Tạm tính').parentElement).toHaveTextContent('75.000đ');
      expect(screen.getByText('Tạm tính').parentElement).not.toHaveTextContent('233.000đ');
    });

    it('thanh dưới nêu đúng dòng hết hàng và cách gỡ (bỏ chọn hoặc xoá), không bảo giảm số lượng', async () => {
      mocks.getCart.mockResolvedValue(summary({ items: [OOS, BUYABLE], subtotal: 233_000, itemCount: 3 }));
      renderPage();
      await screen.findByText('Cobote bột giặt');
      expect(screen.getByText('"Cobote bột giặt" đã hết hàng. Bỏ chọn hoặc xoá sản phẩm này để thanh toán.')).toBeInTheDocument();
      expect(screen.queryByText('Giảm số lượng sản phẩm vượt tồn kho để thanh toán.')).toBeNull();
      expect(screen.getByRole('button', { name: 'Thanh toán (3)' })).toBeDisabled();
    });

    it('bỏ chọn dòng hết hàng: hết lời nhắc, nút Thanh toán mở', async () => {
      mocks.getCart.mockResolvedValue(summary({ items: [OOS, BUYABLE], subtotal: 233_000, itemCount: 3 }));
      renderPage();
      await screen.findByText('Cobote bột giặt');
      fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Cobote bột giặt' }));
      expect(screen.queryByText(/đã hết hàng\. Bỏ chọn/)).toBeNull();
      expect(await screen.findByRole('button', { name: 'Thanh toán (1)' })).toBeEnabled();
    });
  });

  it('đủ tồn → Thanh toán bấm được, không hiện hướng dẫn', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Thanh toán (1)' });
    expect(btn).not.toBeDisabled();
    expect(screen.queryByText('Giảm số lượng sản phẩm vượt tồn kho để thanh toán.')).toBeNull();
  });

  it('dòng vượt suất giờ vàng → hiện lý do tính giá thường do máy chủ trả', async () => {
    const notice = 'Chỉ còn 1 suất giờ vàng. Giảm số lượng còn 1 để được giá giờ vàng, hoặc mua 3 sản phẩm với giá thường.';
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 3, isFlash: false, flashLimitNotice: notice }] }));
    renderPage();
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(screen.getByTestId('flash-limit-notice')).toBeInTheDocument();
  });
});

describe('CartPage — chia theo nơi giao (D4)', () => {
  const TUBU = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
  const SHOP = { kind: 'MERCHANT', storefrontId: 'sf1', name: 'Mật ong Linh' };
  const HONEY = { ...OK_LINE, id: 'ci-m', productName: 'Mật ong rừng', total: 150_000, unitPrice: 150_000, fulfiller: SHOP };
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('giỏ toàn hàng Tubu: không có tiêu đề nơi giao, ngưỡng miễn phí giao hàng như cũ', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, fulfiller: TUBU }] }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.queryByRole('heading', { level: 2, name: 'Tubu Tree giao' })).toBeNull();
    expect(screen.getByText('Mua thêm 150.000đ để được Miễn phí giao hàng 🚚')).toBeInTheDocument();
  });

  it('có hàng gian hàng tự giao: mỗi nơi giao một nhóm (Tubu trước), báo tách đơn; ngưỡng miễn phí giao hàng chỉ tính phần Tubu', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [HONEY, { ...OK_LINE, fulfiller: TUBU }], subtotal: 200_000, freeship: true }));
    renderPage();
    await screen.findByText('Mật ong rừng');
    const sections = screen.getAllByRole('region');
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['Tubu Tree giao', 'Mật ong Linh giao']);
    expect(screen.getByRole('heading', { level: 2, name: 'Mật ong Linh giao' })).toBeInTheDocument();
    expect(screen.getByText(/mỗi nơi giao thành một đơn riêng/)).toBeInTheDocument();
    expect(screen.getByText('Mua thêm 150.000đ để được Miễn phí giao hàng cho phần hàng Tubu Tree giao 🚚')).toBeInTheDocument();
  });

  it('chỉ có hàng gian hàng tự giao: không mời mua thêm để được miễn phí giao hàng', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [HONEY], subtotal: 150_000 }));
    renderPage();
    await screen.findByText('Mật ong rừng');
    expect(screen.queryByText(/Miễn phí giao hàng/)).toBeNull();
    expect(screen.queryByTestId('freeship-progress')).toBeNull();
  });
});

describe('CartPage: tham số xem trước mức giảm mã cho VoucherSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.voucherProps = [];
  });
  const last = () => mocks.voucherProps[mocks.voucherProps.length - 1]!;

  it('chọn cả giỏ: không gửi itemIds, kèm dấu vân tay id + số lượng + thành tiền', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    renderPage();
    await screen.findByRole('button', { name: 'Thanh toán (1)' });
    expect(last().previewParams).toEqual({ storefrontSlug: undefined, itemIds: undefined });
    expect(last().previewKey).toBe('ci-ok:1:50000');
  });

  it('tấm chọn mã nằm ngoài chân dính (z 20): bấm "Chọn mã" mở tấm, tấm không là con của thanh dính, đóng thì tắt', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    renderPage();
    const sheet = await screen.findByTestId('voucher-sheet');
    expect(sheet.dataset.visible).toBe('false');
    expect(sheet.closest('[data-testid="sticky-bar"]')).toBeNull();
    const bar = screen.getByTestId('sticky-bar');
    fireEvent.click(within(bar).getByText('Chọn mã'));
    await waitFor(() => expect(screen.getByTestId('voucher-sheet').dataset.visible).toBe('true'));
    expect(screen.getByTestId('voucher-sheet').closest('[data-testid="sticky-bar"]')).toBeNull();
    act(() => (last().onClose as () => void)());
    await waitFor(() => expect(screen.getByTestId('voucher-sheet').dataset.visible).toBe('false'));
  });

  it('bỏ chọn hết: không hỏi máy chủ (itemIds rỗng bị coi là cả giỏ)', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn tất cả' }));
    await waitFor(() => expect(last().previewParams).toBeUndefined());
  });
});

describe('CartPage: giảm giá combo trong tóm tắt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('có combo: dòng "Giảm giá combo" riêng, tạm tính (đã giảm) = tiền hàng − combo − mã', async () => {
    mocks.getCart.mockResolvedValue(summary({ couponCode: 'XANH10', comboDiscount: 5_000, discount: 2_000 }));
    renderPage();
    expect(await screen.findByText('Giảm giá combo')).toBeInTheDocument();
    expect(screen.getByText('-5.000đ')).toBeInTheDocument();
    expect(screen.getAllByText('-2.000đ').length).toBeGreaterThan(0);
    expect(screen.getByText('43.000đ')).toBeInTheDocument();
  });

  it('có giảm hạng: dòng "Ưu đãi hạng thành viên" riêng, tạm tính (đã giảm) trừ thêm hạng', async () => {
    mocks.getCart.mockResolvedValue(summary({ couponCode: 'XANH10', comboDiscount: 5_000, discount: 2_000, tierDiscount: 1_000 }));
    renderPage();
    expect(await screen.findByText('Ưu đãi hạng thành viên')).toBeInTheDocument();
    expect(screen.getByText('-1.000đ')).toBeInTheDocument();
    expect(screen.getByText('42.000đ')).toBeInTheDocument();
  });

  it('combo 0 hoặc API cũ chưa trả: không có dòng combo, tạm tính như cũ', async () => {
    mocks.getCart.mockResolvedValue(summary({ comboDiscount: 0, discount: 2_000 }));
    const first = renderPage();
    await screen.findByText('Giảm giá');
    expect(screen.queryByText('Giảm giá combo')).toBeNull();
    expect(screen.getByText('48.000đ')).toBeInTheDocument();
    first.unmount();
    mocks.getCart.mockResolvedValue(summary({ discount: 2_000 }));
    renderPage();
    await screen.findByText('Giảm giá');
    expect(screen.queryByText('Giảm giá combo')).toBeNull();
    expect(screen.getByText('48.000đ')).toBeInTheDocument();
  });

  it('sang gian hàng khác: giỏ của gian hàng trước không hiện lại combo (khoá cache kèm gian hàng)', async () => {
    const store = useStorefrontContext;
    store.getState().setContext({ slug: 'shop-a', kind: 'ctv' });
    mocks.getCart.mockImplementation(async () =>
      summary({ comboDiscount: store.getState().slug === 'shop-a' ? 5_000 : 0 }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CartPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Giảm giá combo')).toBeInTheDocument();
    expect(qc.getQueryData(['cart', 'shop-a'])).toBeDefined();
    act(() => store.getState().setContext({ slug: 'shop-b', kind: 'ctv' }));
    await waitFor(() => expect(screen.queryByText('Giảm giá combo')).toBeNull());
    expect(qc.getQueryData(['cart', 'shop-b'])).toMatchObject({ comboDiscount: 0 });
    store.getState().clear();
  });

  it('bỏ chọn một phần giỏ: không hiện combo (checkout tính lại phần chọn)', async () => {
    mocks.getCart.mockResolvedValue(summary({ comboDiscount: 5_000 }));
    renderPage();
    expect(await screen.findByText('Giảm giá combo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả' }));
    await waitFor(() => expect(screen.queryByText('Giảm giá combo')).toBeNull());
  });
});

describe('CartPage: chọn một phần giỏ lấy giá phần chọn từ máy chủ (GET /cart?itemIds)', () => {
  const LINE_B = { ...OK_LINE, id: 'ci-b', variationId: 'v-b', productName: 'Dầu gội', slug: 'dg', unitPrice: 100_000, total: 100_000 };
  const two = (over: object = {}) =>
    summary({ items: [OK_LINE, LINE_B], subtotal: 150_000, itemCount: 2, couponCode: 'XANH10', comboDiscount: 15_000, discount: 9_000, tierDiscount: 3_000, ...over });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCartSelection.mockRejectedValue(new Error('chưa mock'));
  });

  it('bỏ chọn một dòng: hỏi đúng itemIds, hiện combo, mã, hạng và tạm tính đúng số máy chủ trả', async () => {
    mocks.getCart.mockResolvedValue(two());
    mocks.getCartSelection.mockResolvedValue(
      summary({ items: [LINE_B], subtotal: 100_000, itemCount: 1, couponCode: 'XANH10', comboDiscount: 5_000, discount: 3_000, tierDiscount: 1_000 }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Xà bông thảo mộc' }));
    expect(await screen.findByText('-5.000đ', {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(mocks.getCartSelection).toHaveBeenCalledTimes(1);
    expect(mocks.getCartSelection).toHaveBeenLastCalledWith(['ci-b']);
    expect(screen.getByText('Giảm giá combo')).toBeInTheDocument();
    expect(screen.getByText('Ưu đãi hạng thành viên')).toBeInTheDocument();
    expect(screen.getByText('-3.000đ')).toBeInTheDocument();
    expect(screen.getByText('-1.000đ')).toBeInTheDocument();
    expect(screen.getByText('91.000đ')).toBeInTheDocument();
  });

  it('chọn lại tất cả: về giỏ thường trong bộ nhớ, không hỏi thêm máy chủ', async () => {
    mocks.getCart.mockResolvedValue(two());
    mocks.getCartSelection.mockResolvedValue(summary({ items: [LINE_B], subtotal: 100_000, comboDiscount: 5_000, discount: 3_000, tierDiscount: 1_000 }));
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Xà bông thảo mộc' }));
    await screen.findByText('-5.000đ', {}, { timeout: 2_000 });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả' }));
    expect(await screen.findByText('-15.000đ')).toBeInTheDocument();
    expect(screen.getByText('123.000đ')).toBeInTheDocument();
    expect(mocks.getCartSelection).toHaveBeenCalledTimes(1);
  });

  it('cả giỏ ngay từ đầu: không gọi giá phần chọn', async () => {
    mocks.getCart.mockResolvedValue(two());
    renderPage();
    await screen.findByText('Giảm giá combo');
    await new Promise((r) => setTimeout(r, 400));
    expect(mocks.getCartSelection).not.toHaveBeenCalled();
  });

  it('mã không đạt với phần chọn: không giảm, hiện đúng câu giải thích máy chủ trả', async () => {
    mocks.getCart.mockResolvedValue(two());
    mocks.getCartSelection.mockResolvedValue(
      summary({
        items: [LINE_B],
        subtotal: 100_000,
        couponCode: 'XANH10',
        comboDiscount: 0,
        discount: 0,
        tierDiscount: 0,
        couponNotice: 'Mã chưa áp cho đơn này: Đơn tối thiểu 200.000đ.',
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Xà bông thảo mộc' }));
    const notice = await screen.findByTestId('coupon-notice', {}, { timeout: 2_000 });
    expect(notice).toHaveTextContent('Đơn tối thiểu 200.000đ');
    expect(screen.queryByText('Giảm giá combo')).toBeNull();
    expect(screen.getAllByText('100.000đ').length).toBeGreaterThan(0);
  });

  const renderWithClient = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CartPage />
      </QueryClientProvider>,
    );
    return qc;
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('bỏ mã khi đang chọn một phần: hỏi lại giá phần chọn, không còn giảm giá của mã cũ', async () => {
    mocks.getCart.mockResolvedValue(two());
    mocks.getCartSelection.mockResolvedValueOnce(
      summary({ items: [LINE_B], subtotal: 100_000, couponCode: 'XANH10', comboDiscount: 0, discount: 3_000, tierDiscount: 0 }),
    );
    const qc = renderWithClient();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Xà bông thảo mộc' }));
    await screen.findByText('-3.000đ', {}, { timeout: 2_000 });
    expect(screen.getByText('97.000đ')).toBeInTheDocument();
    mocks.getCartSelection.mockResolvedValueOnce(
      summary({ items: [LINE_B], subtotal: 100_000, couponCode: null, comboDiscount: 0, discount: 0, tierDiscount: 0 }),
    );
    act(() => {
      qc.setQueryData(['cart', null], two({ couponCode: null, comboDiscount: 0, discount: 0, tierDiscount: 0 }));
    });
    await waitFor(() => expect(mocks.getCartSelection).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    await waitFor(() => expect(screen.queryByText('-3.000đ')).toBeNull());
  });

  it('áp mã khi đang chọn một phần: hỏi lại giá phần chọn và hiện mức giảm của mã mới', async () => {
    mocks.getCart.mockResolvedValue(two({ couponCode: null, comboDiscount: 0, discount: 0, tierDiscount: 0 }));
    mocks.getCartSelection.mockResolvedValueOnce(
      summary({ items: [LINE_B], subtotal: 100_000, couponCode: null, comboDiscount: 0, discount: 0, tierDiscount: 0 }),
    );
    const qc = renderWithClient();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Xà bông thảo mộc' }));
    await waitFor(() => expect(mocks.getCartSelection).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    await wait(50);
    mocks.getCartSelection.mockResolvedValueOnce(
      summary({ items: [LINE_B], subtotal: 100_000, couponCode: 'XANH10', comboDiscount: 0, discount: 3_000, tierDiscount: 0 }),
    );
    act(() => {
      qc.setQueryData(['cart', null], two({ couponCode: 'XANH10', comboDiscount: 0, discount: 0, tierDiscount: 0 }));
    });
    expect(await screen.findByText('-3.000đ', {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(mocks.getCartSelection).toHaveBeenCalledTimes(2);
  });

  it('giá phần chọn đổi so với giỏ đã tải (hết giờ vàng): tạm tính (đã giảm) theo chính tạm tính của phần chọn', async () => {
    mocks.getCart.mockResolvedValue(two());
    mocks.getCartSelection.mockResolvedValue(
      summary({ items: [LINE_B], subtotal: 90_000, couponCode: 'XANH10', comboDiscount: 0, discount: 3_000, tierDiscount: 0 }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Xà bông thảo mộc' }));
    await screen.findByText('-3.000đ', {}, { timeout: 2_000 });
    expect(screen.getByText('87.000đ')).toBeInTheDocument();
    expect(screen.queryByText('97.000đ')).toBeNull();
  });

  it('chưa có giá phần chọn: không hiện câu giải thích mã (kể cả của cả giỏ); có giá thì hiện câu của phần chọn', async () => {
    mocks.getCart.mockResolvedValue(two({ couponNotice: 'Mã chưa áp cho đơn này: phần giảm combo làm hụt đơn tối thiểu.' }));
    mocks.getCartSelection.mockReturnValue(new Promise(() => {}));
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Xà bông thảo mộc' }));
    await new Promise((r) => setTimeout(r, 450));
    expect(screen.queryByTestId('coupon-notice')).toBeNull();
    expect(screen.queryByText(/phần giảm combo/)).toBeNull();
  });

  describe('chỉ hiện giá phần chọn khi đúng phần đã hỏi, đã xong và không đang hỏi lại', () => {
    const LINE_C = { ...OK_LINE, id: 'ci-c', variationId: 'v-c', productName: 'Nước rửa', slug: 'nr', unitPrice: 100_000, total: 100_000 };
    const three = () => summary({ items: [OK_LINE, LINE_B, LINE_C], subtotal: 250_000, itemCount: 3, couponCode: 'XANH10', comboDiscount: 0, discount: 0, tierDiscount: 0 });
    const P1 = () => summary({ items: [LINE_B, LINE_C], subtotal: 200_000, couponCode: 'XANH10', comboDiscount: 0, discount: 3_000, tierDiscount: 0 });
    const toggle = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Chọn ${name}` }));

    it('đổi lựa chọn: trước khi hết debounce không hiện số của lựa chọn trước, tổng là tạm tính phần mới chọn', async () => {
      mocks.getCart.mockResolvedValue(three());
      mocks.getCartSelection.mockResolvedValueOnce(P1());
      mocks.getCartSelection.mockReturnValue(new Promise(() => {}));
      renderPage();
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Xà bông thảo mộc' }));
      await screen.findByText('-3.000đ', {}, { timeout: 2_000 });
      expect(screen.getByText('197.000đ')).toBeInTheDocument();
      toggle('Nước rửa');
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByText('-3.000đ')).toBeNull();
      expect(screen.queryByText('197.000đ')).toBeNull();
      expect(screen.getAllByText('100.000đ').length).toBeGreaterThan(0);
    });

    it('hỏi lại cùng lựa chọn (đang tải, còn số cũ trong bộ nhớ): không hiện số cũ cho tới khi trả lời xong', async () => {
      mocks.getCart.mockResolvedValue(three());
      mocks.getCartSelection.mockResolvedValueOnce(P1());
      renderPage();
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Xà bông thảo mộc' }));
      await screen.findByText('-3.000đ', {}, { timeout: 2_000 });
      toggle('Xà bông thảo mộc');
      await new Promise((r) => setTimeout(r, 450));
      expect(screen.queryByText('-3.000đ')).toBeNull();
      mocks.getCartSelection.mockReturnValueOnce(new Promise(() => {}));
      toggle('Xà bông thảo mộc');
      await waitFor(() => expect(mocks.getCartSelection).toHaveBeenCalledTimes(2), { timeout: 2_000 });
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByText('-3.000đ')).toBeNull();
      expect(screen.getByText('200.000đ')).toBeInTheDocument();
    });
  });
});

describe('CartPage — thành tiền dòng khi SL > 1 (D6-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProducts.mockResolvedValue({ data: [], meta: { page: 1, limit: 4, total: 0 } });
  });

  it('dòng SL 3, giá 95.000đ → có "Thành tiền" 285.000đ; SL 1 thì không có dòng thành tiền', async () => {
    mocks.getCart.mockResolvedValue(
      summary({
        items: [
          { ...OK_LINE, id: 'ci-3', productName: 'Nước rửa chén', unitPrice: 95_000, quantity: 3, total: 285_000 },
          { ...OK_LINE, id: 'ci-1', variationId: 'v-1', productName: 'Xà bông lẻ', unitPrice: 50_000, quantity: 1, total: 50_000 },
        ],
        subtotal: 335_000,
        itemCount: 4,
      }),
    );
    renderPage();
    await screen.findByText('Nước rửa chén');
    const line = screen.getByText('Nước rửa chén').closest('[class*="zaui-box"], div')!.parentElement as HTMLElement;
    expect(line.textContent).toContain('Thành tiền');
    expect(line.textContent).toContain('285.000đ');
    const single = screen.getByText('Xà bông lẻ').closest('[class*="zaui-box"], div')!.parentElement as HTMLElement;
    expect(single.textContent).not.toContain('Thành tiền');
  });

  it('bấm + (SL local lệch SL server) → ẩn dòng thành tiền, không hiện số tự nhân khi server có thể tính lại giá', async () => {
    mocks.getCart.mockResolvedValue(
      summary({
        items: [{ ...OK_LINE, id: 'ci-f', productName: 'Hàng flash', unitPrice: 50_000, quantity: 2, total: 100_000 }],
        subtotal: 100_000,
        itemCount: 2,
      }),
    );
    renderPage();
    await screen.findByText('Hàng flash');
    expect(screen.getByText(/Thành tiền/)).toHaveTextContent('100.000đ');
    fireEvent.click(screen.getByLabelText('Tăng số lượng'));
    expect(screen.queryByText(/Thành tiền/)).toBeNull();
    expect(screen.queryByText(/150\.000đ/)).toBeNull();
  });

  it('PATCH đang bay (đã qua debounce 380ms, optimistic đã nhân sẵn) → vẫn ẩn dòng thành tiền, chỉ hiện lại khi server trả', async () => {
    let resolvePatch: (v: unknown) => void = () => {};
    mocks.updateCartItem.mockReturnValue(new Promise((r) => { resolvePatch = r; }));
    const flash = { ...OK_LINE, id: 'ci-f', productName: 'Hàng flash', unitPrice: 50_000, quantity: 2, total: 100_000 };
    mocks.getCart.mockResolvedValue(summary({ items: [flash], subtotal: 100_000, itemCount: 2 }));
    renderPage();
    await screen.findByText('Hàng flash');
    fireEvent.click(screen.getByLabelText('Tăng số lượng'));
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledWith('ci-f', 3), { timeout: 2_000 });
    expect(screen.queryByText(/Thành tiền/)).toBeNull();

    // Server tính lại giá (hết suất flash): số hiện ra phải là số server, không phải số client tự nhân.
    mocks.getCart.mockResolvedValue(
      summary({ items: [{ ...flash, quantity: 3, total: 160_000 }], subtotal: 160_000, itemCount: 3 }),
    );
    await act(async () => {
      resolvePatch(summary({ items: [{ ...flash, quantity: 3, total: 160_000 }], subtotal: 160_000, itemCount: 3 }));
    });
    expect(await screen.findByText(/Thành tiền/)).toHaveTextContent('160.000đ');
  });
  it('bàn phím: tên sản phẩm là nút, Enter mở trang sản phẩm (D8-8)', async () => {
    mocks.getCart.mockResolvedValue(
      summary({ items: [{ ...OK_LINE, id: 'ci-k', productName: 'Xà bông bàn phím', slug: 'xb-kb' }] }),
    );
    renderPage();
    const name = await screen.findByRole('button', { name: 'Xà bông bàn phím', hidden: false });
    name.focus();
    await userEvent.keyboard('{Enter}');
    expect(mocks.navigate).toHaveBeenCalledWith('/product/xb-kb');
  });
});

describe('CartPage: nhãn tổng chỉ ghi "(đã giảm)" khi có giảm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCouponPreviews.mockResolvedValue([]);
  });

  it('không áp mã, không combo, không giảm hạng → "Tạm tính", không có "(đã giảm)"', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    renderPage();
    expect(await screen.findByText('Tạm tính')).toBeInTheDocument();
    expect(screen.queryByText(/đã giảm/)).toBeNull();
  });

  it.each([
    ['mã giảm', { couponCode: 'XANH10', discount: 2_000 }],
    ['combo', { comboDiscount: 5_000 }],
    ['hạng thành viên', { tierDiscount: 1_000 }],
  ])('có giảm từ %s → "Tạm tính (đã giảm)"', async (_name, over) => {
    mocks.getCart.mockResolvedValue(summary(over));
    renderPage();
    expect(await screen.findByText('Tạm tính (đã giảm)')).toBeInTheDocument();
  });
});

describe('CartPage: gợi ý mã dùng được ở dòng "Mã giảm giá" (chỉ gợi ý, không tự áp)', () => {
  const preview = (code: string, over: object = {}) => ({ code, eligible: true, discount: 0, ...over });
  beforeEach(() => {
    vi.clearAllMocks();
    useStorefrontContext.getState().clear();
    mocks.getCoupons.mockResolvedValue([{ id: 'c1', code: 'WELCOME30' }]);
  });

  it('ví không có mã nào → không hỏi xem trước (không tính thừa trên máy chủ), giữ câu cũ', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    mocks.getCoupons.mockResolvedValue([]);
    mocks.getCouponPreviews.mockResolvedValue([preview('WELCOME30', { discount: 30_000 })]);
    renderPage();
    const invite = await screen.findByText('Chọn hoặc nhập mã');
    expect(invite).toBeInTheDocument();
    // Lời mời không cắt "…": máy 320px thì xuống dòng trong hàng 44px, như dòng gợi ý (parity với web `coupon-box`).
    expect(invite.getAttribute('data-testid')).toBe('coupon-placeholder');
    expect(invite.getAttribute('style')).not.toMatch(/ellipsis|nowrap|hidden/);
    await waitFor(() => expect(mocks.getCoupons).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(mocks.getCouponPreviews).not.toHaveBeenCalled();
    expect(screen.queryByText(/mã dùng được/)).toBeNull();
  });

  it('hàng mã (máy 320px): nhãn và nội dung chung một khối flex-wrap để nội dung xuống dưới nhãn thay vì bị cắt; hàng giữ vùng chạm 44', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    mocks.getCoupons.mockResolvedValue([]);
    renderPage();
    const invite = await screen.findByTestId('coupon-placeholder');
    const label = screen.getByTestId('coupon-label');
    expect(label.parentElement).toBe(invite.parentElement);
    expect(invite.parentElement!.style.flexWrap).toBe('wrap');
    const row = screen.getByTestId('coupon-row');
    expect(row.getAttribute('role')).toBe('button');
    expect(row.style.minHeight).toBe('44px');
    expect(screen.getByTestId('coupon-cta').textContent).toBe('Chọn mã');
  });

  it('hàng mã đã áp: mã và số giảm cùng khối với nhãn, nút ghi "Thay đổi"', async () => {
    mocks.getCart.mockResolvedValue(summary({ couponCode: 'XANH10', discount: 2_000 }));
    renderPage();
    const code = await screen.findByTestId('coupon-code');
    const label = screen.getByTestId('coupon-label');
    expect(code.parentElement!.parentElement).toBe(label.parentElement);
    expect(label.parentElement!.style.flexWrap).toBe('wrap');
    expect(screen.getByTestId('coupon-discount').textContent).toBe('-2.000đ');
    expect(screen.getByTestId('coupon-cta').textContent).toBe('Thay đổi');
  });

  it('mã dài (trên 15 ký tự): pill cho xuống dòng ngay trong pill, không cắt "…" mất ký tự mã', async () => {
    const long = 'KHUYENMAI-THANG-MUOI-MOT-VIP-2026';
    mocks.getCart.mockResolvedValue(summary({ couponCode: long, discount: 2_000 }));
    renderPage();
    const code = await screen.findByTestId('coupon-code');
    expect(code.textContent).toBe(long);
    expect(code.style.overflowWrap).toBe('anywhere');
    expect(code.style.maxWidth).toBe('100%');
    expect(code.style.textOverflow).toBe('');
    expect(code.style.whiteSpace).not.toBe('nowrap');
    expect(code.style.overflow).not.toBe('hidden');
  });

  it('giỏ chưa có mã, có mã dùng được → "N mã · giảm đến X" (bản ngắn, vừa một dòng), hỏi đúng tham số, không gọi áp mã', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    mocks.getCouponPreviews.mockResolvedValue([
      preview('WELCOME30', { discount: 30_000 }),
      preview('TUBU10', { discount: 5_000 }),
      preview('BIG', { eligible: false, reason: 'Cần đơn tối thiểu 500.000đ', discount: 100_000 }),
    ]);
    renderPage();
    expect(await screen.findByText('2 mã · giảm đến 30k')).toBeInTheDocument();
    expect(screen.queryByText('Chọn hoặc nhập mã')).toBeNull();
    expect(mocks.getCouponPreviews).toHaveBeenCalledTimes(1);
    expect(mocks.getCouponPreviews).toHaveBeenCalledWith({ storefrontSlug: undefined, itemIds: undefined });
  });

  it('không mã nào dùng được, danh sách rỗng hoặc máy chủ lỗi → giữ câu cũ', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    mocks.getCouponPreviews.mockResolvedValue([preview('BIG', { eligible: false, reason: 'x', discount: 9 })]);
    const first = renderPage();
    await waitFor(() => expect(mocks.getCouponPreviews).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Chọn hoặc nhập mã')).toBeInTheDocument();
    expect(screen.queryByText(/mã dùng được/)).toBeNull();
    first.unmount();
    mocks.getCouponPreviews.mockRejectedValue(new Error('API cũ'));
    renderPage();
    await waitFor(() => expect(mocks.getCouponPreviews).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Chọn hoặc nhập mã')).toBeInTheDocument();
  });

  it('giỏ đã có mã → không hỏi xem trước, chip mã như cũ', async () => {
    mocks.getCart.mockResolvedValue(summary({ couponCode: 'XANH10', discount: 2_000 }));
    mocks.getCouponPreviews.mockResolvedValue([preview('WELCOME30', { discount: 30_000 })]);
    renderPage();
    expect(await screen.findByText('XANH10')).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(mocks.getCouponPreviews).not.toHaveBeenCalled();
    expect(screen.queryByText(/mã dùng được/)).toBeNull();
  });
});

describe('CartPage: giá gạch, Tiết kiệm, Countdown Giờ vàng, chân dính (P8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStorefrontContext.getState().clear();
    mocks.getCoupons.mockResolvedValue([]);
  });

  it('dòng có giá niêm yết cao hơn giá bán: gạch giá niêm yết, chân dính ghi Tiết kiệm đúng số; thiếu listUnitPrice thì không', async () => {
    const discounted = { ...OK_LINE, unitPrice: 33_000, listUnitPrice: 50_000, quantity: 2, total: 66_000 };
    mocks.getCart.mockResolvedValue(summary({ items: [discounted], subtotal: 66_000, itemCount: 2 }));
    const first = renderPage();
    const line = (await screen.findByText('Xà bông thảo mộc')).closest('[data-testid="cart-line"]') as HTMLElement;
    expect(within(line).getByText('50.000đ')).toHaveStyle({ textDecoration: 'line-through' });
    expect(within(screen.getByTestId('sticky-bar')).getByText('Tiết kiệm 34.000đ')).toBeInTheDocument();
    first.unmount();
    mocks.getCart.mockResolvedValue(summary({}));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.queryByText(/Tiết kiệm/)).toBeNull();
  });

  // P2 #12: "Tiết kiệm" gồm cả giảm combo (đúng số dòng "Giảm giá combo" đang hiện) và dùng một màu deal như PDP.
  describe('Tiết kiệm cộng cả giảm combo', () => {
    const discounted = { ...OK_LINE, unitPrice: 33_000, listUnitPrice: 50_000, quantity: 2, total: 66_000 };

    it('vừa giá gạch (34.000đ) vừa combo (5.000đ): ghi tổng 39.000đ, số tiền phải trả không đổi', async () => {
      mocks.getCart.mockResolvedValue(summary({ items: [discounted], subtotal: 66_000, itemCount: 2, comboDiscount: 5_000 }));
      renderPage();
      await screen.findByText('Xà bông thảo mộc');
      const bar = screen.getByTestId('sticky-bar');
      expect(within(bar).getByTestId('cart-saving')).toHaveTextContent('Tiết kiệm 39.000đ');
      expect(within(bar).getByTestId('cart-total-value')).toHaveTextContent('61.000đ');
    });

    it('chỉ có combo (không dòng nào gạch giá): vẫn ghi Tiết kiệm đúng số combo', async () => {
      mocks.getCart.mockResolvedValue(summary({ comboDiscount: 5_000 }));
      renderPage();
      await screen.findByText('Xà bông thảo mộc');
      expect(within(screen.getByTestId('sticky-bar')).getByTestId('cart-saving')).toHaveTextContent('Tiết kiệm 5.000đ');
    });

    it('chọn một phần giỏ khi chưa có giá phần chọn: không mượn số combo của cả giỏ', async () => {
      const lineB = { ...OK_LINE, id: 'ci-b', variationId: 'v-b', productName: 'Dầu gội', slug: 'dg', unitPrice: 100_000, total: 100_000 };
      mocks.getCart.mockResolvedValue(summary({ items: [{ ...discounted, quantity: 1, total: 33_000 }, lineB], subtotal: 133_000, itemCount: 2, comboDiscount: 15_000 }));
      mocks.getCartSelection.mockRejectedValue(new Error('chưa có giá phần chọn'));
      renderPage();
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Dầu gội' }));
      await waitFor(() => expect(within(screen.getByTestId('sticky-bar')).getByTestId('cart-total-value')).toHaveTextContent('33.000đ'));
      expect(within(screen.getByTestId('sticky-bar')).getByTestId('cart-saving')).toHaveTextContent('Tiết kiệm 17.000đ');
    });

    it('một màu deal như dòng "Tiết kiệm" ở PDP, không còn xanh', async () => {
      mocks.getCart.mockResolvedValue(summary({ items: [discounted], subtotal: 66_000, itemCount: 2 }));
      renderPage();
      await screen.findByText('Xà bông thảo mộc');
      const saving = within(screen.getByTestId('sticky-bar')).getByTestId('cart-saving');
      expect(saving.style.color).toBe('var(--color-text-price-deal)');
      expect(saving.style.fontWeight).toBe('600');
    });
  });

  it('dòng Giờ vàng: "Kết thúc sau …" thay cho "Đã bán %", đọc được bằng role timer', async () => {
    const flash = { ...OK_LINE, isFlash: true, soldPct: 98, flashEndAt: new Date(Date.now() + 2 * 3_600_000 + 30_000).toISOString() };
    mocks.getCart.mockResolvedValue(summary({ items: [flash] }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.getByRole('timer')).toHaveTextContent('Kết thúc sau 2 giờ 00 phút');
    expect(screen.queryByText(/Đã bán \d+%/)).toBeNull();
  });

  it('dòng Giờ vàng chưa có giờ kết thúc (API cũ): vẫn có nhãn Giờ vàng, không đồng hồ', async () => {
    const flash = { ...OK_LINE, isFlash: true, soldPct: 98 };
    mocks.getCart.mockResolvedValue(summary({ items: [flash] }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.getByText('Giờ vàng')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('chân dính gồm dòng mã giảm giá, tổng và nút Thanh toán (thanh miễn phí giao đã lên đầu giỏ); thân danh sách không còn khối mã', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    const bar = screen.getByTestId('sticky-bar');
    expect(within(bar).getByRole('button', { name: /Mã giảm giá/ })).toBeInTheDocument();
    expect(within(bar).queryByText(/Miễn phí giao hàng/)).toBeNull();
    expect(within(bar).queryByTestId('freeship-bar')).toBeNull();
    expect(within(bar).getByText('Tạm tính')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Thanh toán (1)' })).toBeInTheDocument();
    const body = screen.getByRole('region', { name: 'Sản phẩm trong giỏ' });
    expect(within(body).queryByText('Mã giảm giá')).toBeNull();
  });

  it('đầu giỏ (trên "Chọn tất cả" và danh sách dòng): chưa đạt miễn phí giao thì có thanh tiến độ đúng mức; đạt rồi chỉ còn một dòng chúc mừng, không thanh', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    const first = renderPage();
    await screen.findByText('Xà bông thảo mộc');
    const block = screen.getByTestId('freeship-progress');
    expect(block).toHaveAttribute('data-reached', 'false');
    expect(within(block).getByText('Mua thêm 150.000đ để được Miễn phí giao hàng 🚚')).toBeInTheDocument();
    const barEl = within(block).getByTestId('freeship-bar');
    expect(barEl).toHaveAttribute('role', 'progressbar');
    expect(barEl).toHaveAttribute('aria-valuenow', '25');
    expect(barEl).toHaveAttribute('aria-label', 'Đã đạt 25% để được Miễn phí giao hàng');
    expect(within(block).getByTestId('freeship-fill')).toHaveStyle({ width: '25%' });
    // Thanh nằm trước ô "Chọn tất cả" và trước dòng sản phẩm đầu tiên.
    const selectAll = screen.getByRole('checkbox', { name: 'Chọn tất cả' });
    expect(block.compareDocumentPosition(selectAll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(screen.getByTestId('cart-line')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    first.unmount();
    mocks.getCart.mockResolvedValue(summary({ subtotal: 250_000, freeship: true, items: [{ ...OK_LINE, unitPrice: 250_000, total: 250_000 }] }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    const reached = screen.getByTestId('freeship-progress');
    expect(reached).toHaveAttribute('data-reached', 'true');
    expect(within(reached).getByText('🎉 Đơn hàng đã được Miễn phí giao hàng')).toBeInTheDocument();
    expect(screen.queryByTestId('freeship-bar')).toBeNull();
    expect(screen.queryByTestId('freeship-addons')).toBeNull();
  });

  it('W51B thanh Miễn phí giao hàng có nút "Mua thêm" khi chưa đạt: tên truy cập nêu số còn thiếu, bấm đưa về Trang chủ; đạt rồi không còn nút', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    const first = renderPage();
    await screen.findByText('Xà bông thảo mộc');
    const block = screen.getByTestId('freeship-progress');
    const cta = within(block).getByRole('button', { name: 'Mua thêm: còn thiếu 150.000đ để được Miễn phí giao hàng' });
    expect(cta).toHaveTextContent('Mua thêm');
    mocks.navigate.mockClear();
    fireEvent.click(cta);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/');
    first.unmount();
    mocks.getCart.mockResolvedValue(summary({ subtotal: 250_000, freeship: true, items: [{ ...OK_LINE, unitPrice: 250_000, total: 250_000 }] }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.getByTestId('freeship-progress')).toHaveAttribute('data-reached', 'true');
    expect(screen.queryByTestId('freeship-shop-more-cta')).toBeNull();
  });

  it('chân dính gọn: tổng tiền cùng khối với nhãn (bên trái nút), Tiết kiệm nằm dưới số tiền', async () => {
    const discounted = { ...OK_LINE, unitPrice: 33_000, listUnitPrice: 50_000, total: 33_000 };
    mocks.getCart.mockResolvedValue(summary({ items: [discounted], subtotal: 33_000 }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    const bar = screen.getByTestId('sticky-bar');
    const total = within(bar).getByTestId('cart-total-value');
    expect(total).toHaveTextContent('33.000đ');
    expect(total.parentElement).toContainElement(within(bar).getByText('Tạm tính'));
    expect(total.parentElement).toContainElement(within(bar).getByTestId('cart-saving'));
    expect(total.parentElement).not.toContainElement(within(bar).getByRole('button', { name: 'Thanh toán (1)' }));
  });

  it('bấm dòng mã trong chân dính mở tấm chọn mã', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    const before = mocks.voucherProps.length;
    fireEvent.click(within(screen.getByTestId('sticky-bar')).getByRole('button', { name: /Mã giảm giá/ }));
    await waitFor(() => expect(mocks.voucherProps.at(-1)).toMatchObject({ visible: true }));
    expect(mocks.voucherProps.length).toBeGreaterThan(before);
  });
});

describe('CartPage: gom món của combo dưới đầu nhóm (K5)', () => {
  const LINE_B = { ...OK_LINE, id: 'ci-b', variationId: 'v-b', productName: 'Dầu gội', slug: 'dg', unitPrice: 100_000, total: 100_000 };
  const LINE_C = { ...OK_LINE, id: 'ci-c', variationId: 'v-c', productName: 'Nước xả vải', slug: 'nxv', unitPrice: 80_000, total: 80_000 };
  const GROUP = {
    id: 'collection:c1',
    kind: 'STOREFRONT' as const,
    title: 'Bộ giặt sạch',
    discount: 15_000,
    lineIds: ['ci-ok', 'ci-b'],
    keyLineIds: ['ci-ok', 'ci-b'],
  };
  const comboCart = (over: object = {}) =>
    summary({
      items: [OK_LINE, LINE_C, LINE_B],
      subtotal: 230_000,
      itemCount: 3,
      comboDiscount: 15_000,
      comboGroups: [GROUP],
      ...over,
    });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCartSelection.mockRejectedValue(new Error('chưa mock'));
  });

  it('các dòng của bộ nằm chung một khối có đầu nhóm "Combo: tên · Tiết kiệm số", dòng lẻ nằm ngoài; chân dính vẫn ghi số combo', async () => {
    mocks.getCart.mockResolvedValue(comboCart());
    renderPage();
    const group = await screen.findByTestId('cart-combo-group');
    expect(within(group).getByTestId('cart-combo-heading')).toHaveTextContent('Combo: Bộ giặt sạch · Tiết kiệm 15.000đ');
    expect(group).toHaveAccessibleName('Combo: Bộ giặt sạch · Tiết kiệm 15.000đ');
    expect(within(group).getAllByTestId('cart-line')).toHaveLength(2);
    expect(within(group).getByText('Xà bông thảo mộc')).toBeInTheDocument();
    expect(within(group).getByText('Dầu gội')).toBeInTheDocument();
    expect(within(group).queryByText('Nước xả vải')).toBeNull();
    expect(screen.getAllByTestId('cart-line')).toHaveLength(3);
    const bar = screen.getByTestId('sticky-bar');
    expect(within(bar).getByText('Giảm giá combo')).toBeInTheDocument();
    expect(within(bar).getByText('-15.000đ')).toBeInTheDocument();
  });

  it('máy chủ chưa trả nhóm combo: mọi dòng vẽ như trước, không có đầu nhóm', async () => {
    mocks.getCart.mockResolvedValue(comboCart({ comboGroups: undefined }));
    renderPage();
    await screen.findByText('Dầu gội');
    expect(screen.queryByTestId('cart-combo-group')).toBeNull();
    expect(screen.getAllByTestId('cart-line')).toHaveLength(3);
  });

  it('bỏ chọn một món khoá của bộ: đầu nhóm bỏ số Tiết kiệm và nhắc chọn đủ món để được giảm', async () => {
    mocks.getCart.mockResolvedValue(comboCart());
    renderPage();
    const group = await screen.findByTestId('cart-combo-group');
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Chọn Dầu gội' }));
    expect(within(group).getByTestId('cart-combo-heading')).toHaveTextContent(/^Combo: Bộ giặt sạch$/);
    expect(within(group).getByTestId('cart-combo-hint')).toHaveTextContent('Chọn đủ các món để được giảm 15.000đ');
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Chọn Dầu gội' }));
    expect(within(group).queryByTestId('cart-combo-hint')).toBeNull();
    expect(within(group).getByTestId('cart-combo-heading')).toHaveTextContent('Tiết kiệm 15.000đ');
  });

  it('bấm thùng rác món khoá: hỏi trước "sẽ mất giảm", chưa xoá; "Giữ lại" thì thôi', async () => {
    mocks.getCart.mockResolvedValue(comboCart());
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá Dầu gội' }));
    expect(await screen.findByText('Bỏ món khỏi combo?')).toBeInTheDocument();
    expect(screen.getByText('Combo Bộ giặt sạch sẽ mất giảm 15.000đ nếu bạn bỏ món này.')).toBeInTheDocument();
    expect(mocks.removeCartItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Giữ lại' }));
    expect(mocks.removeCartItem).not.toHaveBeenCalled();
    expect(screen.getByText('Dầu gội')).toBeInTheDocument();
  });

  it('"Vẫn bỏ" xoá đúng dòng; không chặn khách', async () => {
    const after = comboCart({ items: [OK_LINE, LINE_C], subtotal: 130_000, itemCount: 2, comboDiscount: 0, comboGroups: [] });
    mocks.getCart.mockResolvedValueOnce(comboCart()).mockResolvedValue(after);
    mocks.removeCartItem.mockResolvedValue(after);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá Dầu gội' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Vẫn bỏ' }));
    await waitFor(() => expect(mocks.removeCartItem).toHaveBeenCalledWith('ci-b'));
    await waitFor(() => expect(screen.queryByTestId('cart-combo-group')).toBeNull());
    expect(screen.queryByText('Giảm giá combo')).toBeNull();
  });

  it('dòng lẻ xoá ngay, không hỏi', async () => {
    mocks.getCart.mockResolvedValue(comboCart());
    mocks.removeCartItem.mockResolvedValue(comboCart({ items: [OK_LINE, LINE_B], subtotal: 150_000, itemCount: 2 }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá Nước xả vải' }));
    await waitFor(() => expect(mocks.removeCartItem).toHaveBeenCalledWith('ci-c'));
    expect(screen.queryByText('Bỏ món khỏi combo?')).toBeNull();
  });

  describe('giỏ vừa sửa, chờ máy chủ tính lại: khối không nhảy và hộp báo vẫn đúng', () => {
    const never = () => new Promise<never>(() => undefined);

    it('bấm + trên dòng của bộ khi PATCH còn bay: đầu nhóm giữ chỗ của số (ẩn, không đọc) nên không đổi số dòng; dòng "Giảm giá combo" ở chân tắt chờ máy chủ', async () => {
      mocks.getCart.mockResolvedValue(comboCart());
      mocks.updateCartItem.mockImplementation(never);
      renderPage();
      const group = await screen.findByTestId('cart-combo-group');
      const heading = within(group).getByTestId('cart-combo-heading');
      const before = heading.innerHTML;
      expect(heading.querySelector('[data-testid="cart-combo-saving"]')).not.toHaveAttribute('aria-hidden');
      fireEvent.click(within(group).getAllByRole('button', { name: 'Tăng số lượng' })[0]!);
      await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledWith('ci-ok', 2), { timeout: 2_000 });
      await waitFor(() => expect(screen.queryByText('Giảm giá combo')).toBeNull());
      const saving = heading.querySelector<HTMLElement>('[data-testid="cart-combo-saving"]');
      expect(saving, 'chỗ của số còn trong đầu nhóm').not.toBeNull();
      expect(saving).toHaveAttribute('aria-hidden', 'true');
      expect(saving!.style.visibility).toBe('hidden');
      expect(saving!.textContent).toBe(' · Tiết kiệm 15.000đ');
      expect(heading.textContent).toBe('Combo: Bộ giặt sạch · Tiết kiệm 15.000đ');
      expect(heading.innerHTML.replace(' aria-hidden="true"', '').replace(' style="visibility: hidden;"', '')).toBe(before);
      expect(within(group).getByRole('heading', { name: 'Combo: Bộ giặt sạch' })).toBe(heading);
      expect(group).toHaveAccessibleName('Combo: Bộ giặt sạch');
    });

    it('xoá một món lẻ rồi, trong lúc còn chờ máy chủ, bỏ món khoá của bộ: vẫn được báo "sẽ mất giảm" bằng số lần trước', async () => {
      mocks.getCart.mockResolvedValue(comboCart());
      mocks.removeCartItem.mockImplementation(never);
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Xoá Nước xả vải' }));
      await waitFor(() => expect(mocks.removeCartItem).toHaveBeenCalledWith('ci-c'));
      await waitFor(() => expect(screen.queryByText('Giảm giá combo')).toBeNull());
      fireEvent.click(screen.getByRole('button', { name: 'Xoá Dầu gội' }));
      expect(await screen.findByText('Combo Bộ giặt sạch sẽ mất giảm 15.000đ nếu bạn bỏ món này.')).toBeInTheDocument();
      expect(mocks.removeCartItem).toHaveBeenCalledTimes(1);
    });
  });

  it('món trong bộ nhưng không phải món khoá (bộ vẫn khớp khi bỏ nó) xoá ngay, không hỏi', async () => {
    mocks.getCart.mockResolvedValue(comboCart({ comboGroups: [{ ...GROUP, keyLineIds: ['ci-ok'] }] }));
    mocks.removeCartItem.mockResolvedValue(comboCart({ items: [OK_LINE, LINE_C], subtotal: 130_000, itemCount: 2 }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá Dầu gội' }));
    await waitFor(() => expect(mocks.removeCartItem).toHaveBeenCalledWith('ci-b'));
    expect(screen.queryByText('Bỏ món khỏi combo?')).toBeNull();
  });

  describe('mua kèm: sản phẩm chính (dòng khoá không mang giảm) nằm trong khối của bộ', () => {
    // ci-ok là sản phẩm chính, ci-b là món kèm duy nhất được giảm; ci-c không thuộc bộ.
    const ADDON = {
      id: 'bundle:a1',
      kind: 'ADDON' as const,
      title: 'Mua kèm dầu gội',
      discount: 11_000,
      lineIds: ['ci-b'],
      keyLineIds: ['ci-ok'],
    };
    const addonCart = (over: object = {}) => comboCart({ comboDiscount: 11_000, comboGroups: [ADDON], ...over });

    it('khối ghi cả sản phẩm chính lẫn món kèm dưới đầu nhóm; món không thuộc bộ nằm ngoài', async () => {
      mocks.getCart.mockResolvedValue(addonCart());
      renderPage();
      const group = await screen.findByTestId('cart-combo-group');
      expect(within(group).getByTestId('cart-combo-heading')).toHaveTextContent('Combo: Mua kèm dầu gội · Tiết kiệm 11.000đ');
      expect(within(group).getAllByTestId('cart-line')).toHaveLength(2);
      expect(within(group).getByText('Xà bông thảo mộc')).toBeInTheDocument();
      expect(within(group).getByText('Dầu gội')).toBeInTheDocument();
      expect(within(group).queryByText('Nước xả vải')).toBeNull();
    });

    it('bấm thùng rác sản phẩm chính (món nằm trong khối) hỏi trước "sẽ mất giảm"; "Vẫn bỏ" mới xoá', async () => {
      const after = addonCart({ items: [LINE_C, LINE_B], subtotal: 180_000, itemCount: 2, comboDiscount: 0, comboGroups: [] });
      mocks.getCart.mockResolvedValueOnce(addonCart()).mockResolvedValue(after);
      mocks.removeCartItem.mockResolvedValue(after);
      renderPage();
      const group = await screen.findByTestId('cart-combo-group');
      expect(within(group).getByRole('button', { name: 'Xoá Xà bông thảo mộc' })).toBeInTheDocument();
      fireEvent.click(within(group).getByRole('button', { name: 'Xoá Xà bông thảo mộc' }));
      expect(await screen.findByText('Combo Mua kèm dầu gội sẽ mất giảm 11.000đ nếu bạn bỏ món này.')).toBeInTheDocument();
      expect(mocks.removeCartItem).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Vẫn bỏ' }));
      await waitFor(() => expect(mocks.removeCartItem).toHaveBeenCalledWith('ci-ok'));
    });
  });

  describe('chọn một phần giỏ: đầu nhóm theo giá phần chọn của máy chủ', () => {
    // Bộ cần ci-ok (khoá) và ci-b; nước xả ci-c không thuộc bộ.
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it('máy chủ không còn nhóm trong phần chọn: đầu nhóm bỏ số Tiết kiệm và nhắc chọn đủ món; chưa có giá thì giữ luật khoá', async () => {
      const group = { ...GROUP, keyLineIds: ['ci-ok'] };
      mocks.getCart.mockResolvedValue(comboCart({ comboGroups: [group] }));
      mocks.getCartSelection.mockResolvedValue(summary({ items: [OK_LINE, LINE_C], subtotal: 130_000, itemCount: 2, comboDiscount: 0, comboGroups: [] }));
      renderPage();
      const block = await screen.findByTestId('cart-combo-group');
      fireEvent.click(within(block).getByRole('checkbox', { name: 'Chọn Dầu gội' }));
      expect(within(block).getByTestId('cart-combo-heading')).toHaveTextContent('Tiết kiệm 15.000đ');
      await waitFor(() => expect(within(block).getByTestId('cart-combo-heading')).toHaveTextContent(/^Combo: Bộ giặt sạch$/), { timeout: 2_000 });
      expect(within(block).getByTestId('cart-combo-hint')).toHaveTextContent('Chọn đủ các món để được giảm 15.000đ');
    });

    // Số đầu nhóm là số của cả giỏ; chọn một phần mà máy chủ chưa trả giá phần đó (debounce, đang tải, lỗi) thì không có số nào đúng để ghi (K5 MINOR).
    describe('chưa có giá phần chọn: đầu nhóm không ghi số của cả giỏ', () => {
      const keyOnlyOk = () => comboCart({ comboGroups: [{ ...GROUP, keyLineIds: ['ci-ok'] }] });
      const savingOf = (block: HTMLElement) => within(block).getByTestId('cart-combo-heading').querySelector<HTMLElement>('[data-testid="cart-combo-saving"]')!;
      const expectHidden = (block: HTMLElement) => {
        expect(savingOf(block)).toHaveAttribute('aria-hidden', 'true');
        expect(savingOf(block).style.visibility).toBe('hidden');
        expect(block).toHaveAccessibleName('Combo: Bộ giặt sạch');
      };

      it('vừa bỏ chọn một món không khoá (chờ debounce và đang hỏi máy chủ): chỗ của số giữ nguyên nhưng ẩn, tên khối không có số', async () => {
        mocks.getCart.mockResolvedValue(keyOnlyOk());
        mocks.getCartSelection.mockReturnValue(new Promise(() => {}));
        renderPage();
        const block = await screen.findByTestId('cart-combo-group');
        expect(savingOf(block)).not.toHaveAttribute('aria-hidden');
        fireEvent.click(within(block).getByRole('checkbox', { name: 'Chọn Dầu gội' }));
        expectHidden(block);
        await waitFor(() => expect(mocks.getCartSelection).toHaveBeenCalledTimes(1), { timeout: 2_000 });
        expectHidden(block);
        expect(savingOf(block).textContent).toBe(' · Tiết kiệm 15.000đ');
      });

      it('máy chủ trả lỗi (retry=false): vẫn ẩn số, không quay về số của cả giỏ', async () => {
        mocks.getCart.mockResolvedValue(keyOnlyOk());
        mocks.getCartSelection.mockRejectedValue(new Error('chưa có giá phần chọn'));
        renderPage();
        const block = await screen.findByTestId('cart-combo-group');
        fireEvent.click(within(block).getByRole('checkbox', { name: 'Chọn Dầu gội' }));
        await waitFor(() => expect(mocks.getCartSelection).toHaveBeenCalledTimes(1), { timeout: 2_000 });
        await wait(50);
        expectHidden(block);
      });

      it('máy chủ trả giá phần chọn: số của phần chọn hiện lại; chọn lại cả giỏ thì số cả giỏ hiện, không hỏi thêm', async () => {
        const group = { ...GROUP, keyLineIds: ['ci-ok'] };
        mocks.getCart.mockResolvedValue(comboCart({ comboGroups: [group] }));
        mocks.getCartSelection.mockResolvedValue(
          summary({ items: [OK_LINE, LINE_C], subtotal: 130_000, itemCount: 2, comboDiscount: 6_000, comboGroups: [{ ...group, discount: 6_000, lineIds: ['ci-ok'] }] }),
        );
        renderPage();
        const block = await screen.findByTestId('cart-combo-group');
        fireEvent.click(within(block).getByRole('checkbox', { name: 'Chọn Dầu gội' }));
        await waitFor(() => expect(savingOf(block)).not.toHaveAttribute('aria-hidden'), { timeout: 2_000 });
        expect(savingOf(block).textContent).toBe(' · Tiết kiệm 6.000đ');
        fireEvent.click(within(block).getByRole('checkbox', { name: 'Chọn Dầu gội' }));
        expect(savingOf(block).textContent).toBe(' · Tiết kiệm 15.000đ');
        expect(savingOf(block)).not.toHaveAttribute('aria-hidden');
        expect(mocks.getCartSelection).toHaveBeenCalledTimes(1);
      });
    });

    it('máy chủ còn nhóm nhưng giảm ít hơn: đầu nhóm ghi số của phần chọn, khớp dòng "Giảm giá combo" ở chân', async () => {
      const group = { ...GROUP, keyLineIds: ['ci-ok'] };
      mocks.getCart.mockResolvedValue(comboCart({ comboGroups: [group] }));
      mocks.getCartSelection.mockResolvedValue(
        summary({
          items: [OK_LINE, LINE_C],
          subtotal: 130_000,
          itemCount: 2,
          comboDiscount: 6_000,
          comboGroups: [{ ...group, discount: 6_000, lineIds: ['ci-ok'] }],
        }),
      );
      renderPage();
      const block = await screen.findByTestId('cart-combo-group');
      fireEvent.click(within(block).getByRole('checkbox', { name: 'Chọn Dầu gội' }));
      await waitFor(() => expect(within(block).getByTestId('cart-combo-heading')).toHaveTextContent('Combo: Bộ giặt sạch · Tiết kiệm 6.000đ'), { timeout: 2_000 });
      expect(within(screen.getByTestId('sticky-bar')).getByText('-6.000đ')).toBeInTheDocument();
    });

    it('hộp báo bỏ món gỡ khi dòng chờ xoá không còn trong giỏ (máy khác đã xoá), không bật lại và "Vẫn bỏ" không xoá dòng đã mất', async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      mocks.getCart.mockResolvedValue(comboCart());
      render(
        <QueryClientProvider client={qc}>
          <CartPage />
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Xoá Dầu gội' }));
      expect(await screen.findByText('Bỏ món khỏi combo?')).toBeInTheDocument();
      mocks.getCart.mockResolvedValue(comboCart({ items: [OK_LINE, LINE_C], subtotal: 130_000, itemCount: 2, comboDiscount: 0, comboGroups: [] }));
      await qc.invalidateQueries({ queryKey: ['cart'] });
      await waitFor(() => expect(screen.queryByText('Bỏ món khỏi combo?')).toBeNull());
      await wait(50);
      expect(mocks.removeCartItem).not.toHaveBeenCalled();
    });
  });
});

describe('CartPage — W28: đơn tối thiểu của mã khi giỏ đổi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCoupons.mockResolvedValue([]);
    mocks.getCouponPreviews.mockResolvedValue([]);
  });

  it('cả giỏ giữ mã chưa áp vì thiếu đơn tối thiểu: chân giỏ nói lý do kèm số cần mua thêm', async () => {
    mocks.getCart.mockResolvedValue(
      summary({
        couponCode: 'MIN200',
        couponNotice: 'Mã chưa được áp dụng cho đơn này: Đơn tối thiểu 200.000đ để dùng mã này.',
        couponShortfall: 150_000,
      }),
    );
    renderPage();
    const notice = await screen.findByTestId('coupon-notice');
    expect(notice).toHaveTextContent('Đơn tối thiểu 200.000đ để dùng mã này. Mua thêm 150.000đ để áp mã MIN200.');
  });

  it('giữ mã chưa áp vì lý do khác (không có số thiếu): chỉ câu của máy chủ, không nói mua thêm', async () => {
    mocks.getCart.mockResolvedValue(
      summary({ couponCode: 'PSGRAN', couponNotice: 'Mã chưa được áp dụng cho đơn này: Sản phẩm áp dụng mã đang có giá Giờ vàng.' }),
    );
    renderPage();
    const notice = await screen.findByTestId('coupon-notice');
    expect(notice).toHaveTextContent('Sản phẩm áp dụng mã đang có giá Giờ vàng.');
    expect(notice).not.toHaveTextContent('Mua thêm');
  });

  it('mã đang áp bình thường, không có lời báo: không dựng khối lời báo', async () => {
    mocks.getCart.mockResolvedValue(summary({ couponCode: 'GIAM10', discount: 5_000 }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.queryByTestId('coupon-notice')).toBeNull();
    expect(screen.queryByTestId('coupon-removed-notice')).toBeNull();
  });

  it('phần chọn một phần giỏ giữ mã chưa áp: lời báo của phần chọn cũng kèm số cần mua thêm', async () => {
    const TWO = summary({
      items: [OK_LINE, { ...OK_LINE, id: 'ci-b', variationId: 'v-b', productName: 'Dầu gội', total: 100_000, unitPrice: 100_000 }],
      subtotal: 150_000,
      itemCount: 2,
      couponCode: 'MIN200',
    });
    mocks.getCart.mockResolvedValue(TWO);
    mocks.getCartSelection.mockResolvedValue(
      summary({
        items: [OK_LINE],
        subtotal: 50_000,
        couponCode: 'MIN200',
        couponNotice: 'Mã chưa được áp dụng cho đơn này: Đơn tối thiểu 200.000đ để dùng mã này.',
        couponShortfall: 150_000,
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Dầu gội' }));
    const notice = await screen.findByTestId('coupon-notice', {}, { timeout: 2_000 });
    expect(notice).toHaveTextContent('Mua thêm 150.000đ để áp mã MIN200.');
  });

  it('máy chủ gỡ mã vì giỏ rơi dưới đơn tối thiểu: báo mã nào bị gỡ và cần mua thêm bao nhiêu; bấm Đóng thì mất', async () => {
    mocks.getCart.mockResolvedValue(
      summary({ couponRemoved: { code: 'MIN300', reason: 'Đơn tối thiểu 300.000đ để dùng mã này.', shortfall: 250_000 } }),
    );
    renderPage();
    const note = await screen.findByTestId('coupon-removed-notice');
    expect(note).toHaveTextContent('Đã gỡ mã MIN300 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 250.000đ để dùng lại.');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng lời báo mã MIN300 đã gỡ' }));
    await waitFor(() => expect(screen.queryByTestId('coupon-removed-notice')).toBeNull());
  });

  // Máy chủ gỡ mã ngay trong lệnh xoá và chỉ báo `couponRemoved` trong phản hồi của lệnh; lần đọc giỏ sau đó mã đã không còn nên không báo nữa.
  describe('xoá món làm giỏ rơi dưới đơn tối thiểu (phản hồi của lệnh xoá mang couponRemoved, lần đọc lại thì không)', () => {
    const OTHER = { ...OK_LINE, id: 'ci-b', variationId: 'v-b', productName: 'Dầu gội', total: 100_000, unitPrice: 100_000 };
    const FULL = summary({ items: [OK_LINE, OTHER], subtotal: 150_000, itemCount: 2, couponCode: 'MIN150', discount: 20_000 });
    const REMOVED = { code: 'MIN150', reason: 'Đơn tối thiểu 150.000đ để dùng mã này.', shortfall: 100_000 };

    beforeEach(() => {
      mocks.getCart.mockResolvedValueOnce(FULL).mockResolvedValue(summary({ couponCode: null, couponRemoved: null }));
      mocks.removeCartItem.mockResolvedValue(summary({ couponCode: null, couponRemoved: REMOVED }));
    });

    it('báo mã bị gỡ kèm số cần mua thêm, vẫn còn sau khi giỏ được đọc lại', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Xoá Dầu gội' }));
      const note = await screen.findByTestId('coupon-removed-notice');
      expect(note).toHaveTextContent('Đã gỡ mã MIN150 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 100.000đ để dùng lại.');
      await waitFor(() => expect(mocks.getCart.mock.calls.length).toBeGreaterThanOrEqual(2));
      expect(screen.getByTestId('coupon-removed-notice')).toBeInTheDocument();
    });

    it('bấm Đóng: lời báo mất và không hiện lại khi giỏ được đọc lại', async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Xoá Dầu gội' }));
      await screen.findByTestId('coupon-removed-notice');
      fireEvent.click(screen.getByRole('button', { name: 'Đóng lời báo mã MIN150 đã gỡ' }));
      await waitFor(() => expect(screen.queryByTestId('coupon-removed-notice')).toBeNull());
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByTestId('coupon-removed-notice')).toBeNull();
    });

    it('đổi số lượng (PATCH) làm máy chủ gỡ mã: cũng báo', async () => {
      mocks.updateCartItem.mockResolvedValue(summary({ couponCode: null, couponRemoved: REMOVED }));
      mocks.getCart.mockReset();
      const two = { ...OK_LINE, quantity: 2, total: 100_000, unitPrice: 50_000 };
      mocks.getCart.mockResolvedValueOnce(summary({ items: [two], subtotal: 100_000, itemCount: 2, couponCode: 'MIN150', discount: 20_000 })).mockResolvedValue(summary({ couponCode: null, couponRemoved: null }));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Giảm số lượng' }));
      await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledWith('ci-ok', 1), { timeout: 2_000 });
      expect(await screen.findByTestId('coupon-removed-notice')).toHaveTextContent('Đã gỡ mã MIN150');
    });
  });
});

describe('CartPage: thanh Miễn phí giao hàng và dải gợi ý bù đơn (W42A)', () => {
  // Giỏ mặc định: 1 dòng 50.000đ, ngưỡng 200.000đ, còn thiếu 150.000đ.
  const best = (n: number, name: string, price: number, over: Record<string, unknown> = {}) => ({
    id: `b${n}`,
    slug: `bs-${n}`,
    brand: 'Tubu',
    name,
    thumbnail: null,
    basePrice: price,
    salePrice: null,
    repVariationId: `vb${n}`,
    isFeatured: false,
    inStock: true,
    ...over,
  });
  const PAGE = (cards: ReturnType<typeof best>[]) => ({ data: cards, meta: { page: 1, limit: 8, total: cards.length } });
  // A, B đóng được khoảng thiếu một mình; C, D rẻ hơn; xb (đã có trong giỏ), quá đắt và hết hàng bị loại.
  const CARDS = () => [
    best(1, 'Món A', 150_000),
    best(2, 'Món B', 170_000),
    best(3, 'Món C', 60_000),
    best(4, 'Món D', 90_000),
    best(5, 'Đã có trong giỏ', 40_000, { slug: 'xb', repVariationId: 'v-ok' }),
    best(6, 'Quá đắt', 400_000),
    best(7, 'Hết hàng', 70_000, { inStock: false }),
  ];
  const addBtn = (name: string) => screen.getByRole('button', { name: new RegExp(`^Thêm ${name} vào giỏ`) });
  const barText = () => within(screen.getByTestId('freeship-progress')).getByRole('status').textContent;
  let resolveAdd: () => void;
  const pendingAdds: Array<() => void> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCart.mockReset();
    mocks.getCart.mockResolvedValue(summary({}));
    mocks.fetchProducts.mockReset();
    mocks.fetchProducts.mockResolvedValue(PAGE(CARDS()));
    mocks.addToCart.mockReset();
    pendingAdds.length = 0;
    mocks.addToCart.mockImplementation(() => new Promise((r) => { resolveAdd = () => r(summary({})); pendingAdds.push(resolveAdd); }));
  });

  it('chưa đạt: dải gợi ý hiện dưới thanh, ưu tiên món đóng được khoảng thiếu (rẻ trước) rồi các món rẻ hơn; loại món đã có trong giỏ, quá đắt, hết hàng', async () => {
    renderPage();
    const rail = await screen.findByTestId('freeship-addons');
    expect(within(rail).getAllByTestId('freeship-addon').map((c) => within(c).getByText(/^Món /).textContent)).toEqual(['Món A', 'Món B', 'Món C', 'Món D']);
    expect(within(rail).queryByText('Đã có trong giỏ')).toBeNull();
    expect(within(rail).queryByText('Quá đắt')).toBeNull();
    expect(within(rail).queryByText('Hết hàng')).toBeNull();
    const bar = screen.getByTestId('freeship-progress');
    expect(bar.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rail.compareDocumentPosition(screen.getByRole('checkbox', { name: 'Chọn tất cả' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(addBtn('Món C')).toHaveAccessibleName('Thêm Món C vào giỏ, 60.000đ');
  });

  it('một chạm "+ Thêm": thêm đúng phân loại 1 cái, thanh chạy ngay (không chờ máy chủ), nút của thẻ đó khoá + bận', async () => {
    renderPage();
    await screen.findByTestId('freeship-addons');
    expect(barText()).toBe('Mua thêm 150.000đ để được Miễn phí giao hàng 🚚');
    fireEvent.click(addBtn('Món C'));
    await waitFor(() => expect(barText()).toBe('Mua thêm 90.000đ để được Miễn phí giao hàng 🚚'));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).toHaveBeenCalledWith('vb3', 1);
    expect(screen.getByTestId('freeship-bar')).toHaveAttribute('aria-valuenow', '55');
    expect(screen.getByTestId('freeship-fill')).toHaveStyle({ width: '55%' });
    // Món vừa thêm đã vào giỏ nên rời khỏi dải; nút các thẻ còn lại dùng được.
    expect(screen.queryByRole('button', { name: /^Thêm Món C vào giỏ/ })).toBeNull();
    expect(screen.getAllByText('Món C').length).toBeGreaterThan(0);
    act(() => resolveAdd());
  });

  it('hai cú chạm sát nhau vào cùng một món trước khi vẽ lại: chỉ thêm một lần; món khác vẫn thêm được ngay', async () => {
    renderPage();
    await screen.findByTestId('freeship-addons');
    const [d, c] = [addBtn('Món D'), addBtn('Món C')];
    fireEvent.click(d);
    fireEvent.click(d);
    fireEvent.click(c);
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(mocks.addToCart.mock.calls).toEqual([['vb4', 1], ['vb3', 1]]);
    const base = mocks.getCart.mock.calls.length;
    act(() => pendingAdds[1]!());
    await act(async () => {});
    expect(mocks.getCart.mock.calls.length).toBe(base);
    act(() => pendingAdds[0]!());
    await waitFor(() => expect(mocks.getCart.mock.calls.length).toBeGreaterThan(base));
  });

  it('xong một lần thêm thì được thêm món khác', async () => {
    mocks.addToCart.mockResolvedValue(summary({}));
    renderPage();
    await screen.findByTestId('freeship-addons');
    fireEvent.click(addBtn('Món C'));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.getCart.mock.calls.length).toBeGreaterThan(1));
    fireEvent.click(addBtn('Món D'));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    expect(mocks.addToCart).toHaveBeenLastCalledWith('vb4', 1);
  });

  it('thêm món đủ bù khoảng thiếu: thanh chuyển sang chúc mừng, dải biến mất', async () => {
    renderPage();
    await screen.findByTestId('freeship-addons');
    fireEvent.click(addBtn('Món A'));
    await waitFor(() => expect(screen.getByTestId('freeship-progress')).toHaveAttribute('data-reached', 'true'));
    expect(barText()).toBe('🎉 Đơn hàng đã được Miễn phí giao hàng');
    expect(screen.queryByTestId('freeship-bar')).toBeNull();
    expect(screen.queryByTestId('freeship-addons')).toBeNull();
    act(() => resolveAdd());
  });

  it('thêm lỗi: trả giỏ về như cũ (thanh lùi lại), báo lỗi, nút bấm lại được', async () => {
    mocks.addToCart.mockRejectedValue(new Error('hết hàng rồi'));
    renderPage();
    await screen.findByTestId('freeship-addons');
    fireEvent.click(addBtn('Món C'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(barText()).toBe('Mua thêm 150.000đ để được Miễn phí giao hàng 🚚'));
    expect(addBtn('Món C')).toBeEnabled();
    expect(addBtn('Món C')).not.toHaveAttribute('aria-busy');
    expect(addBtn('Món C')).not.toHaveAttribute('aria-disabled');
  });

  it('chỉ gợi ý món Tubu giao: món gian hàng tự giao hoặc gian hàng đang nghỉ bị loại; thẻ cũ không ghi người giao vẫn tính là Tubu giao', async () => {
    const MERCHANT = { kind: 'MERCHANT', name: 'Gian hàng Mộc', shippingFee: 20_000, freeShipFrom: null };
    const PAUSED = { kind: 'UNAVAILABLE', name: 'Gian hàng nghỉ', shippingFee: null, freeShipFrom: null, reason: 'STORE_PAUSED' };
    mocks.fetchProducts.mockResolvedValue(
      PAGE([
        best(1, 'Món A', 150_000, { fulfiller: { kind: 'TUBU', name: 'Tubu Tree', shippingFee: null, freeShipFrom: null } }),
        best(2, 'Món B', 170_000, { fulfiller: MERCHANT }),
        best(3, 'Món C', 60_000, { fulfiller: PAUSED }),
        best(4, 'Món D', 90_000),
        best(8, 'Món E', 80_000),
      ]),
    );
    renderPage();
    const rail = await screen.findByTestId('freeship-addons');
    expect(within(rail).getAllByTestId('freeship-addon').map((c) => c.getAttribute('data-slug'))).toEqual(['bs-1', 'bs-4', 'bs-8']);
  });

  it('Bán chạy nhất lỗi: thanh vẫn hiện, chỉ ẩn dải (không chặn giỏ)', async () => {
    mocks.fetchProducts.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByTestId('freeship-progress')).toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchProducts).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('freeship-addons')).toBeNull();
    expect(screen.getByText('Xà bông thảo mộc')).toBeInTheDocument();
  });

  it('dưới 3 món phù hợp: dải ẩn hẳn (không để tiêu đề trơ)', async () => {
    mocks.fetchProducts.mockResolvedValue(PAGE([best(1, 'Món A', 150_000), best(3, 'Món C', 60_000)]));
    renderPage();
    await screen.findByTestId('freeship-progress');
    await waitFor(() => expect(mocks.fetchProducts).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('freeship-addons')).toBeNull();
    expect(screen.queryByText('Gợi ý mua thêm cho đủ Miễn phí giao hàng')).toBeNull();
  });

  it('bỏ chọn bớt món: thanh tính theo phần đang chọn, còn thiếu nhiều hơn thì dải gợi ý theo số mới', async () => {
    const second = { ...OK_LINE, id: 'ci-2', variationId: 'v-2', slug: 'x2', productName: 'Dầu gội', unitPrice: 20_000, total: 20_000 };
    mocks.getCart.mockResolvedValue(summary({ items: [OK_LINE, second], subtotal: 70_000, itemCount: 2 }));
    renderPage();
    await screen.findByTestId('freeship-addons');
    expect(barText()).toBe('Mua thêm 130.000đ để được Miễn phí giao hàng 🚚');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Dầu gội' }));
    await waitFor(() => expect(barText()).toBe('Mua thêm 150.000đ để được Miễn phí giao hàng 🚚'));
  });

  it('giỏ chưa tải xong: chưa có thanh lẫn dải gợi ý', async () => {
    mocks.getCart.mockReturnValue(new Promise(() => {}));
    renderPage();
    await act(async () => {});
    expect(screen.queryByTestId('freeship-progress')).toBeNull();
    expect(screen.queryByTestId('freeship-addons')).toBeNull();
  });
});

describe('CartPage: nút "Mua thêm" ở dòng sắp mở khoá mã (W50A)', () => {
  // Giỏ mẫu 50.000đ: thiếu 50.000đ là trong tầm CART_VOUCHER_UNLOCK_MAX_GAP nên dòng sắp mở khoá hiện.
  const GIAM45 = { id: 'c-giam45', code: 'GIAM45', type: 'AMOUNT', value: 45_000, minOrder: 100_000, maxDiscount: null, endAt: '2030-01-01T00:00:00Z' };
  const SAP_MO = { code: 'GIAM45', eligible: false, discount: 0, reason: 'Đơn tối thiểu 100.000đ để dùng mã này.', shortfall: 50_000 };
  beforeEach(() => {
    vi.clearAllMocks();
    useStorefrontContext.getState().clear();
  });

  it('còn thiếu để mở mã: dòng nhắc có nút "Mua thêm", bấm thì về trang chủ', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    mocks.getCoupons.mockResolvedValue([GIAM45]);
    mocks.getCouponPreviews.mockResolvedValue([SAP_MO]);
    renderPage();
    const cta = await screen.findByTestId('cart-voucher-unlock-cta');
    expect(cta.textContent).toBe('Mua thêm');
    fireEvent.click(cta);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });

  it('chỉ có mã dùng được, không có dòng sắp mở khoá: dải hiện "Áp dụng ngay" nhưng không có nút "Mua thêm"', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    mocks.getCoupons.mockResolvedValue([GIAM45]);
    mocks.getCouponPreviews.mockResolvedValue([{ code: 'GIAM45', eligible: true, discount: 45_000 }]);
    renderPage();
    await screen.findByTestId('cart-voucher-apply-cta');
    expect(screen.queryByTestId('cart-voucher-unlock')).toBeNull();
    expect(screen.queryByTestId('cart-voucher-unlock-cta')).toBeNull();
  });
});

describe('CartPage: khoá chạm đúp và đua khi đổi giỏ, Thử lại tại chỗ khi báo giá phần chọn lỗi (W72A)', () => {
  const LINE_B = { ...OK_LINE, id: 'ci-b', variationId: 'v-b', productName: 'Dầu gội', slug: 'dg', unitPrice: 100_000, total: 100_000 };
  const two = () => summary({ items: [OK_LINE, LINE_B], subtotal: 150_000, itemCount: 2 });
  const pending = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const EMPTY = summary({ items: [], subtotal: 0, itemCount: 0 });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCart.mockResolvedValue(summary({}));
    mocks.getCartSelection.mockRejectedValue(new Error('chưa mock'));
    mocks.fetchProducts.mockResolvedValue({ data: [], meta: { page: 1, limit: 4, total: 0 } });
  });

  it('chạm đúp "Hoàn tác" trong cùng một khung hình: chỉ thêm lại món một lần', async () => {
    mocks.removeCartItem.mockResolvedValue(EMPTY);
    const add = pending<ReturnType<typeof summary>>();
    mocks.addToCart.mockReturnValue(add.promise);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá Xà bông thảo mộc' }));
    const undo = await screen.findByRole('button', { name: 'Hoàn tác' });
    await act(async () => {
      fireEvent.click(undo);
      fireEvent.click(undo);
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).toHaveBeenCalledWith('v-ok', 1);
    await act(async () => add.resolve(summary({})));
  });

  it('Hoàn tác xong thì nhả khoá: xoá rồi Hoàn tác lần nữa vẫn thêm lại được', async () => {
    mocks.removeCartItem.mockResolvedValue(EMPTY);
    mocks.addToCart.mockResolvedValue(summary({}));
    renderPage();
    for (let round = 1; round <= 2; round += 1) {
      fireEvent.click(await screen.findByRole('button', { name: 'Xoá Xà bông thảo mộc' }));
      const undo = await screen.findByRole('button', { name: 'Hoàn tác' });
      await act(async () => fireEvent.click(undo));
      await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(round));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull());
    }
  });

  it('chạm đúp nút Xoá dòng trong cùng một khung hình: chỉ xoá một lần (không nhận 404 lần hai)', async () => {
    const remove = pending<ReturnType<typeof summary>>();
    mocks.removeCartItem.mockReturnValue(remove.promise);
    renderPage();
    const button = await screen.findByRole('button', { name: 'Xoá Xà bông thảo mộc' });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mocks.removeCartItem).toHaveBeenCalledTimes(1);
    await act(async () => remove.resolve(EMPTY));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(mocks.removeCartItem).toHaveBeenCalledTimes(1);
  });

  it('hai dòng khác nhau: xoá cả hai liền nhau vẫn gửi đủ hai lệnh', async () => {
    mocks.getCart.mockResolvedValue(two());
    const remove = pending<ReturnType<typeof summary>>();
    mocks.removeCartItem.mockReturnValue(remove.promise);
    renderPage();
    const a = await screen.findByRole('button', { name: 'Xoá Xà bông thảo mộc' });
    const b = await screen.findByRole('button', { name: 'Xoá Dầu gội' });
    await act(async () => {
      fireEvent.click(a);
      fireEvent.click(b);
    });
    expect(mocks.removeCartItem.mock.calls.map((c) => c[0]).sort()).toEqual(['ci-b', 'ci-ok']);
    await act(async () => remove.resolve(EMPTY));
  });

  it('đổi số lượng một dòng hai lần liên tiếp: lệnh sau chờ lệnh trước xong rồi mới gửi, đúng thứ tự (không đảo thứ tự ở máy chủ)', async () => {
    const resolvers: Array<(v: ReturnType<typeof summary>) => void> = [];
    mocks.updateCartItem.mockImplementation(() => new Promise((res) => resolvers.push(res)));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(mocks.updateCartItem).toHaveBeenCalledTimes(1);
    await act(async () => resolvers[0]!(summary({})));
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledTimes(2));
    expect(mocks.updateCartItem.mock.calls).toEqual([['ci-ok', 2], ['ci-ok', 3]]);
    await act(async () => resolvers[1]!(summary({})));
  });

  it('đổi số lượng rồi xoá dòng khi lệnh đổi còn bay: lệnh xoá xếp sau, đúng thứ tự bấm (không nhận 404 hoàn lại dòng đã xoá)', async () => {
    const patches: Array<(v: ReturnType<typeof summary>) => void> = [];
    mocks.updateCartItem.mockImplementation(() => new Promise((res) => patches.push(res)));
    mocks.removeCartItem.mockResolvedValue(EMPTY);
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Xoá Xà bông thảo mộc' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(mocks.removeCartItem).not.toHaveBeenCalled();
    await act(async () => patches[0]!(summary({})));
    await waitFor(() => expect(mocks.removeCartItem).toHaveBeenCalledTimes(1));
    expect(mocks.updateCartItem.mock.invocationCallOrder[0]!).toBeLessThan(mocks.removeCartItem.mock.invocationCallOrder[0]!);
    expect(await screen.findByRole('button', { name: 'Hoàn tác' })).toBeInTheDocument();
  });

  it('xoá dòng B khi lệnh xoá dòng A còn bay: A xong vẫn mở thanh Hoàn tác (không mất callback của lần gọi trước)', async () => {
    mocks.getCart.mockResolvedValue(two());
    const deletes: Array<(v: ReturnType<typeof summary>) => void> = [];
    mocks.removeCartItem.mockImplementation(() => new Promise((res) => deletes.push(res)));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá Xà bông thảo mộc' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá Dầu gội' }));
    await waitFor(() => expect(mocks.removeCartItem).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
    await act(async () => deletes[0]!(EMPTY));
    expect(await screen.findByRole('button', { name: 'Hoàn tác' })).toBeInTheDocument();
    await act(async () => deletes[1]!(EMPTY));
  });

  it('lệnh đổi số lượng trước bị lỗi: lệnh sau vẫn được gửi', async () => {
    mocks.updateCartItem.mockRejectedValueOnce(new Error('mạng')).mockResolvedValue(summary({}));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledTimes(2), { timeout: 2_000 });
  });

  it('hai dòng khác nhau đổi số lượng cùng lúc: không chờ nhau', async () => {
    mocks.getCart.mockResolvedValue(two());
    mocks.updateCartItem.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByText('Dầu gội');
    const pluses = screen.getAllByRole('button', { name: 'Tăng số lượng' });
    fireEvent.click(pluses[0]!);
    fireEvent.click(pluses[1]!);
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    expect(mocks.updateCartItem.mock.calls.map((c) => c[0]).sort()).toEqual(['ci-b', 'ci-ok']);
  });

  it('hai lệnh đổi số lượng đang bay: lệnh xong trước chưa đọc lại giỏ (khỏi nháy số cũ), lệnh xong sau mới đọc lại', async () => {
    const resolvers: Array<(v: ReturnType<typeof summary>) => void> = [];
    mocks.updateCartItem.mockImplementation(() => new Promise((res) => resolvers.push(res)));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    const base = mocks.getCart.mock.calls.length;
    await act(async () => resolvers[0]!(summary({})));
    await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(mocks.getCart.mock.calls.length).toBe(base);
    await act(async () => resolvers[1]!(summary({})));
    await waitFor(() => expect(mocks.getCart.mock.calls.length).toBeGreaterThan(base));
  });

  it('một lệnh đổi số lượng xong lẻ loi: đọc lại giỏ như trước', async () => {
    mocks.updateCartItem.mockResolvedValue(summary({}));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    const base = mocks.getCart.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    await waitFor(() => expect(mocks.getCart.mock.calls.length).toBeGreaterThan(base), { timeout: 2_000 });
  });

  describe('báo giá phần đã chọn lỗi', () => {
    const deselectFirst = async () => {
      mocks.getCart.mockResolvedValue(two());
      renderPage();
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Xà bông thảo mộc' }));
      return screen.findByTestId('cart-selection-error', {}, { timeout: 3_000 });
    };

    it('chọn một phần mà máy chủ không báo giá được: hiện dòng báo và nút Thử lại tên riêng, không im lặng', async () => {
      const box = await deselectFirst();
      expect(box).toHaveAttribute('role', 'alert');
      expect(within(box).getByRole('button', { name: 'Thử lại báo giá phần đã chọn' })).toBeInTheDocument();
    });

    it('Thử lại hỏi lại máy chủ; được thì dòng báo biến mất và hiện số của phần chọn', async () => {
      const box = await deselectFirst();
      mocks.getCartSelection.mockResolvedValue(summary({ items: [LINE_B], subtotal: 100_000, itemCount: 1, discount: 3_000 }));
      const calls = mocks.getCartSelection.mock.calls.length;
      fireEvent.click(within(box).getByRole('button', { name: 'Thử lại báo giá phần đã chọn' }));
      await waitFor(() => expect(screen.queryByTestId('cart-selection-error')).toBeNull());
      expect(mocks.getCartSelection.mock.calls.length).toBe(calls + 1);
      expect(await screen.findByText('-3.000đ')).toBeInTheDocument();
    });

    it('đổi lựa chọn sau khi lỗi: dòng báo của phần chọn cũ biến mất ngay, không chờ kết quả của phần chọn mới', async () => {
      const LINE_C = { ...OK_LINE, id: 'ci-c', variationId: 'v-c', productName: 'Kem đánh răng', slug: 'kdr', unitPrice: 30_000, total: 30_000 };
      mocks.getCart.mockResolvedValue(summary({ items: [OK_LINE, LINE_B, LINE_C], subtotal: 180_000, itemCount: 3 }));
      renderPage();
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Chọn Xà bông thảo mộc' }));
      await screen.findByTestId('cart-selection-error', {}, { timeout: 3_000 });
      fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Dầu gội' }));
      expect(screen.queryByTestId('cart-selection-error')).toBeNull();
      expect(await screen.findByTestId('cart-selection-error', {}, { timeout: 3_000 })).toBeInTheDocument();
    });

    it('Thử lại mà vẫn lỗi: dòng báo được dựng lại (trình đọc màn hình đọc lại lần thất bại thứ hai)', async () => {
      const box = await deselectFirst();
      const calls = mocks.getCartSelection.mock.calls.length;
      fireEvent.click(within(box).getByRole('button', { name: 'Thử lại báo giá phần đã chọn' }));
      await waitFor(() => expect(mocks.getCartSelection.mock.calls.length).toBe(calls + 1));
      await waitFor(() => expect(screen.getByTestId('cart-selection-error')).not.toBe(box));
      expect(screen.getByTestId('cart-selection-error')).toHaveAttribute('role', 'alert');
    });

    it('chạm đúp Thử lại trong cùng một khung hình: chỉ hỏi máy chủ thêm một lần', async () => {
      const box = await deselectFirst();
      const retry = pending<ReturnType<typeof summary>>();
      mocks.getCartSelection.mockReturnValue(retry.promise);
      const calls = mocks.getCartSelection.mock.calls.length;
      const button = within(box).getByRole('button', { name: 'Thử lại báo giá phần đã chọn' });
      await act(async () => {
        fireEvent.click(button);
        fireEvent.click(button);
      });
      expect(mocks.getCartSelection.mock.calls.length).toBe(calls + 1);
      await act(async () => retry.resolve(summary({ items: [LINE_B], subtotal: 100_000, itemCount: 1 })));
    });

    it('chọn cả giỏ (không cần giá phần chọn): không có dòng báo lỗi', async () => {
      mocks.getCart.mockResolvedValue(two());
      renderPage();
      await screen.findByText('Dầu gội');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 450));
      });
      expect(screen.queryByTestId('cart-selection-error')).toBeNull();
    });
  });
});

describe('CartPage: "Thử lại" khi giỏ không tải được (hồi quy, W92A không đổi hành vi)', () => {
  const pending = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCartSelection.mockRejectedValue(new Error('chưa mock'));
    mocks.fetchProducts.mockResolvedValue({ data: [], meta: { page: 1, limit: 4, total: 0 } });
  });

  it('chạm đúp trong cùng một khung hình chỉ tải giỏ thêm một lần (giỏ chưa có dữ liệu nên react-query gộp lần hai); trong lúc tải lại hiện khung chờ, xong thì hiện giỏ', async () => {
    mocks.getCart.mockRejectedValueOnce(new Error('offline'));
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    const next = pending<ReturnType<typeof summary>>();
    mocks.getCart.mockReturnValue(next.promise);
    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.getCart).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull());
    await act(async () => next.resolve(summary({})));
    expect(await screen.findByText('Xà bông thảo mộc')).toBeInTheDocument();
  });
});

// W113A: lệnh ghi giỏ bị máy chủ từ chối vì giỏ đã cũ (400/404/409) thì nút giữ khoá tới khi giỏ làm mới về (tối đa LOCK_REFRESH_WAIT_MS). Mất mạng, quá hạn, 401, 5xx không nói gì về giỏ: nhả ngay.
describe('CartPage: máy chủ từ chối thì giữ khoá tới khi giỏ làm mới về (W113A)', () => {
  type Opened = { invalidate: MockInstance<QueryClient['invalidateQueries']>; button: () => HTMLElement };
  type Case = {
    name: string;
    write: ReturnType<typeof vi.fn>;
    succeed: unknown;
    /** Số lần tải lại giỏ mà lệnh vẫn tự gọi ở `onSettled` (không tính lần giữ khoá) khi lỗi không phải lời từ chối. */
    settledInvalidates: number;
    busyAttr?: boolean;
    open: (refresh: () => Promise<unknown>) => Promise<Opened>;
  };
  const LINE_B = { ...OK_LINE, id: 'ci-b', variationId: 'v-b', productName: 'Dầu gội', slug: 'dg', unitPrice: 100_000, total: 100_000 };
  const two = () => summary({ items: [OK_LINE, LINE_B], subtotal: 150_000, itemCount: 2 });
  const EMPTY = summary({ items: [], subtotal: 0, itemCount: 0 });
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const renderLive = (refresh: () => Promise<unknown>) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(
      <QueryClientProvider client={qc}>
        <CartPage />
      </QueryClientProvider>,
    );
    return invalidate;
  };
  const filters = (invalidate: Opened['invalidate']) => invalidate.mock.calls.map(([filter]) => filter);
  const card = (n: number, name: string, price: number) => ({
    id: `b${n}`, slug: `bs-${n}`, brand: 'Tubu', name, thumbnail: null, basePrice: price, salePrice: null,
    repVariationId: `vb${n}`, isFeatured: false, inStock: true,
  });
  /** Máy chủ trả lỗi sau một nhịp: lệnh bay đủ lâu để lần vẽ giữa chừng (số lượng tạm) kịp xảy ra như trên mạng thật. */
  const rejectLater = (error: unknown, ms = 60) => new Promise<never>((_, reject) => setTimeout(() => reject(error), ms));

  const CASES: Case[] = [
    {
      name: 'xoá dòng ngừng bán',
      write: mocks.removeCartItem,
      succeed: summary({ unavailableItems: [] }),
      settledInvalidates: 0,
      open: async (refresh) => {
        mocks.getCart.mockResolvedValue(summary({ unavailableItems: [GONE] }));
        const invalidate = renderLive(refresh);
        await screen.findByText('1 sản phẩm đã ngừng bán');
        return { invalidate, button: () => screen.getByRole('button', { name: 'Xoá' }) };
      },
    },
    {
      name: 'xoá dòng giỏ',
      write: mocks.removeCartItem,
      succeed: EMPTY,
      settledInvalidates: 1,
      open: async (refresh) => {
        mocks.getCart.mockResolvedValue(summary({}));
        const invalidate = renderLive(refresh);
        await screen.findByText('Xà bông thảo mộc');
        return { invalidate, button: () => screen.getByRole('button', { name: 'Xoá Xà bông thảo mộc' }) };
      },
    },
    {
      name: 'thêm món bù đơn',
      write: mocks.addToCart,
      succeed: summary({}),
      settledInvalidates: 1,
      busyAttr: true,
      open: async (refresh) => {
        mocks.getCart.mockResolvedValue(summary({}));
        mocks.fetchProducts.mockResolvedValue({ data: [card(3, 'Món C', 60_000), card(4, 'Món D', 90_000), card(5, 'Món E', 70_000)], meta: { page: 1, limit: 8, total: 3 } });
        const invalidate = renderLive(refresh);
        await screen.findByTestId('freeship-addons');
        return { invalidate, button: () => screen.getByRole('button', { name: /^Thêm Món C vào giỏ/ }) };
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [mocks.removeCartItem, mocks.addToCart, mocks.updateCartItem, mocks.getCart]) fn.mockReset();
    mocks.getCartSelection.mockRejectedValue(new Error('chưa mock'));
    mocks.fetchProducts.mockResolvedValue({ data: [], meta: { page: 1, limit: 4, total: 0 } });
  });

  describe.each(CASES)('$name', (c) => {
    it.each([
      [400, 'Món này không còn trong giỏ'],
      [404, 'Không tìm thấy dòng này'],
      [409, 'Giỏ vừa có thay đổi, bạn thử lại nhé'],
    ])('bị từ chối %i: báo lỗi một lần, tải lại giỏ, giữ khoá tới khi giỏ về rồi mới nhả', async (status, message) => {
      c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(c.succeed);
      const refresh = deferred();
      const { invalidate, button } = await c.open(() => refresh.promise);
      fireEvent.click(button());
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
      expect(errorSnackbars()).toBe(1);
      expect(filters(invalidate)).toEqual([{ queryKey: ['cart'] }]);
      await waitFor(() => expect(button()).toBeInTheDocument());
      if (c.busyAttr) expect(button()).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        fireEvent.click(button());
        fireEvent.click(button());
      });
      expect(c.write).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      if (c.busyAttr) await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      expect(errorSnackbars()).toBe(1);
      fireEvent.click(button());
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ])('%s: không giữ khoá chờ tải lại, nhả ngay; không tải lại thêm so với trước', async (_label, error) => {
      c.write.mockRejectedValueOnce(error).mockResolvedValue(c.succeed);
      const { invalidate, button } = await c.open(() => new Promise(() => undefined));
      fireEvent.click(button());
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await waitFor(() => expect(button()).toBeInTheDocument());
      await settle();
      if (c.busyAttr) expect(button()).not.toHaveAttribute('aria-busy');
      expect(filters(invalidate)).toEqual(Array.from({ length: c.settledInvalidates }, () => ({ queryKey: ['cart'] })));
      fireEvent.click(button());
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      c.write.mockRejectedValueOnce(serverError('Giỏ vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue(c.succeed);
      const { button } = await c.open(() => new Promise(() => undefined));
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        fireEvent.click(button());
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
        });
        await waitFor(() => expect(button()).toBeInTheDocument());
        await act(async () => {
          fireEvent.click(button());
        });
        expect(c.write).toHaveBeenCalledTimes(1);
        if (c.busyAttr) expect(button()).toHaveAttribute('aria-busy', 'true');
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
        if (c.busyAttr) await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      } finally {
        vi.useRealTimers();
      }
      fireEvent.click(button());
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });
  });

  describe('đổi số lượng (không có khoá riêng: cờ đang gửi của dòng giữ tới khi giỏ về)', () => {
    const TWO_UNITS = { ...OK_LINE, quantity: 2, total: 100_000 };

    it('bị từ chối 409: giỏ hoàn lại nhưng "Thành tiền" (số tự nhân) chưa hiện lại cho tới khi giỏ thật về', async () => {
      mocks.getCart.mockResolvedValue(summary({ items: [TWO_UNITS], subtotal: 100_000, itemCount: 2 }));
      mocks.updateCartItem.mockImplementationOnce(() => rejectLater(serverError('Giỏ vừa có thay đổi, bạn thử lại nhé', 409)));
      const refresh = deferred();
      const invalidate = renderLive(() => refresh.promise);
      await screen.findByText('Xà bông thảo mộc');
      expect(screen.getByText(/Thành tiền/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
      await waitFor(() => expect(errorSnackbars()).toBe(1), { timeout: 3_000 });
      expect(filters(invalidate)).toEqual([{ queryKey: ['cart'] }]);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 600));
      });
      expect(screen.queryByText(/Thành tiền/)).toBeNull();
      await act(async () => refresh.resolve());
      expect(await screen.findByText(/Thành tiền/)).toBeInTheDocument();
    });

    it('bị từ chối 503: không giữ cờ chờ, "Thành tiền" hiện lại ngay sau khi hoàn lại; chỉ tải lại một lần như trước', async () => {
      mocks.getCart.mockResolvedValue(summary({ items: [TWO_UNITS], subtotal: 100_000, itemCount: 2 }));
      mocks.updateCartItem.mockImplementationOnce(() => rejectLater(serverError('Service Unavailable', 503)));
      const invalidate = renderLive(() => new Promise(() => undefined));
      await screen.findByText('Xà bông thảo mộc');
      fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
      await waitFor(() => expect(errorSnackbars()).toBe(1), { timeout: 3_000 });
      expect(await screen.findByText(/Thành tiền/)).toBeInTheDocument();
      expect(filters(invalidate)).toEqual([{ queryKey: ['cart'] }]);
    });

    it('lệnh khác của giỏ còn bay khi lệnh này bị từ chối: chưa tải lại (bản về lúc đó thiếu lệnh kia); lệnh xong cuối tải lại đúng một lần', async () => {
      mocks.getCart.mockResolvedValue(two());
      const other = deferred();
      mocks.updateCartItem.mockImplementation((id: string) =>
        id === 'ci-ok' ? rejectLater(serverError('Giỏ vừa có thay đổi, bạn thử lại nhé', 409), 700) : (other.promise as Promise<unknown>),
      );
      const invalidate = renderLive(() => Promise.resolve());
      await screen.findByText('Dầu gội');
      for (const plus of screen.getAllByRole('button', { name: 'Tăng số lượng' })) fireEvent.click(plus);
      await waitFor(() => expect(mocks.updateCartItem).toHaveBeenCalledTimes(2), { timeout: 3_000 });
      await waitFor(() => expect(errorSnackbars()).toBe(1), { timeout: 3_000 });
      await settle();
      expect(filters(invalidate)).toEqual([]);
      await act(async () => other.resolve(summary({})));
      await settle();
      expect(filters(invalidate)).toEqual([{ queryKey: ['cart'] }]);
    });
  });

  describe('Hoàn tác (thêm lại món vừa xoá)', () => {
    const removeThenFindUndo = async (name: string) => {
      fireEvent.click(await screen.findByRole('button', { name }));
      return screen.findByRole('button', { name: 'Hoàn tác' });
    };

    it('máy chủ từ chối 409: tải lại giỏ và giữ khoá Hoàn tác tới khi giỏ về (Hoàn tác của món xoá kế tiếp chưa chạy)', async () => {
      mocks.getCart.mockResolvedValue(two());
      mocks.removeCartItem.mockResolvedValue(EMPTY);
      mocks.addToCart.mockRejectedValueOnce(serverError('Món này đã hết hàng', 409)).mockResolvedValue(summary({}));
      const refresh = deferred();
      const invalidate = renderLive(() => refresh.promise);
      const undoA = await removeThenFindUndo('Xoá Xà bông thảo mộc');
      invalidate.mockClear();
      await act(async () => fireEvent.click(undoA));
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      expect(filters(invalidate)).toEqual([{ queryKey: ['cart'] }]);
      const undoB = await removeThenFindUndo('Xoá Dầu gội');
      await act(async () => fireEvent.click(undoB));
      expect(mocks.addToCart).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      await act(async () => fireEvent.click(undoB));
      await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
      expect(mocks.addToCart).toHaveBeenLastCalledWith('v-b', 1);
    });

    it('mất mạng: không tải lại giỏ, nhả khoá ngay', async () => {
      mocks.getCart.mockResolvedValue(summary({}));
      mocks.removeCartItem.mockResolvedValue(EMPTY);
      mocks.addToCart.mockRejectedValueOnce(new HttpError('Network Error', 'ERR_NETWORK'));
      const invalidate = renderLive(() => new Promise(() => undefined));
      const undo = await removeThenFindUndo('Xoá Xà bông thảo mộc');
      invalidate.mockClear();
      await act(async () => fireEvent.click(undo));
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await settle();
      expect(filters(invalidate)).toEqual([]);
    });
  });
});
