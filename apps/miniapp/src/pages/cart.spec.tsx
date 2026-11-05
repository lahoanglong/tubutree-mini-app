import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getCart: vi.fn(),
  getCartSelection: vi.fn(),
  removeCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  voucherProps: [] as Record<string, unknown>[],
  fetchProducts: vi.fn(),
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
  addToCart: vi.fn(),
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

  it('chạm trần mà tồn cao (40/40): dòng "Còn 40 sản phẩm" chữ thường, không icon cảnh báo (L5 3)', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 40, stock: 40, total: 2_000_000 }] }));
    renderPage();
    const note = await screen.findByText('Còn 40 sản phẩm');
    expect(note.getAttribute('style')).toContain('--color-text-secondary');
    expect(note.getAttribute('style')).not.toContain('--color-text-warning');
    expect(note.parentElement!.querySelector('svg')).toBeNull();
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

  it('bấm + tới trần: dòng tồn kho hiện cùng lúc nút + khoá, không đợi máy chủ (L5 3)', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 39, stock: 40, total: 1_950_000 }] }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.queryByText('Còn 40 sản phẩm')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    expect(screen.getByText('Còn 40 sản phẩm')).toBeInTheDocument();
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
      expect(screen.getByText('Mua thêm 125.000đ để được miễn phí giao hàng')).toBeInTheDocument();
      expect(screen.queryByText('Bạn được miễn phí giao hàng 🌿')).toBeNull();
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
    expect(screen.getByText('Mua thêm 150.000đ để được miễn phí giao hàng')).toBeInTheDocument();
  });

  it('có hàng gian hàng tự giao: mỗi nơi giao một nhóm (Tubu trước), báo tách đơn; ngưỡng miễn phí giao hàng chỉ tính phần Tubu', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [HONEY, { ...OK_LINE, fulfiller: TUBU }], subtotal: 200_000, freeship: true }));
    renderPage();
    await screen.findByText('Mật ong rừng');
    const sections = screen.getAllByRole('region');
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['Tubu Tree giao', 'Mật ong Linh giao']);
    expect(screen.getByRole('heading', { level: 2, name: 'Mật ong Linh giao' })).toBeInTheDocument();
    expect(screen.getByText(/mỗi nơi giao thành một đơn riêng/)).toBeInTheDocument();
    expect(screen.getByText('Mua thêm 150.000đ để được miễn phí giao hàng cho phần hàng Tubu Tree giao')).toBeInTheDocument();
  });

  it('chỉ có hàng gian hàng tự giao: không mời mua thêm để được miễn phí giao hàng', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [HONEY], subtotal: 150_000 }));
    renderPage();
    await screen.findByText('Mật ong rừng');
    expect(screen.queryByText(/miễn phí giao hàng/)).toBeNull();
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
    expect(await screen.findByText('Chọn hoặc nhập mã giảm giá')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getCoupons).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(mocks.getCouponPreviews).not.toHaveBeenCalled();
    expect(screen.queryByText(/mã dùng được/)).toBeNull();
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
    expect(screen.queryByText('Chọn hoặc nhập mã giảm giá')).toBeNull();
    expect(mocks.getCouponPreviews).toHaveBeenCalledTimes(1);
    expect(mocks.getCouponPreviews).toHaveBeenCalledWith({ storefrontSlug: undefined, itemIds: undefined });
  });

  it('không mã nào dùng được, danh sách rỗng hoặc máy chủ lỗi → giữ câu cũ', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    mocks.getCouponPreviews.mockResolvedValue([preview('BIG', { eligible: false, reason: 'x', discount: 9 })]);
    const first = renderPage();
    await waitFor(() => expect(mocks.getCouponPreviews).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Chọn hoặc nhập mã giảm giá')).toBeInTheDocument();
    expect(screen.queryByText(/mã dùng được/)).toBeNull();
    first.unmount();
    mocks.getCouponPreviews.mockRejectedValue(new Error('API cũ'));
    renderPage();
    await waitFor(() => expect(mocks.getCouponPreviews).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Chọn hoặc nhập mã giảm giá')).toBeInTheDocument();
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

  it('chân dính gồm dòng mã giảm giá, thanh miễn phí giao, tổng và nút Thanh toán; thân danh sách không còn khối mã', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    const bar = screen.getByTestId('sticky-bar');
    expect(within(bar).getByRole('button', { name: /Mã giảm giá/ })).toBeInTheDocument();
    expect(within(bar).getByText(/Mua thêm 150\.000đ để được miễn phí giao hàng/)).toBeInTheDocument();
    expect(within(bar).getByText('Tạm tính')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Thanh toán (1)' })).toBeInTheDocument();
    const body = screen.getByRole('region', { name: 'Sản phẩm trong giỏ' });
    expect(within(body).queryByText('Mã giảm giá')).toBeNull();
  });

  it('chân dính gọn: chưa đạt miễn phí giao thì có thanh tiến độ; đạt rồi chỉ còn một dòng chữ, không thanh', async () => {
    mocks.getCart.mockResolvedValue(summary({}));
    const first = renderPage();
    await screen.findByText('Xà bông thảo mộc');
    const barEl = screen.getByTestId('freeship-bar');
    expect(barEl).toBeInTheDocument();
    // Trang mua sắm chỉ dùng token ngữ nghĩa (P2 #15): rãnh --color-track, không trỏ bậc primitive --stone-200/--forest-200.
    expect(barEl.getAttribute('style')).toContain('var(--color-track)');
    expect(barEl.outerHTML).not.toMatch(/var\(--(?:stone|forest)-\d+\)/);
    // Đầu dải màu của phần đã đầy là token riêng của thanh tiến độ (cùng web), không mượn token viền của nút phụ.
    const fillEl = barEl.firstElementChild as HTMLElement;
    expect(fillEl.getAttribute('style')).toContain('var(--color-progress-fill-from)');
    expect(fillEl.getAttribute('style')).not.toContain('action-secondary-border');
    first.unmount();
    mocks.getCart.mockResolvedValue(summary({ subtotal: 250_000, freeship: true, items: [{ ...OK_LINE, unitPrice: 250_000, total: 250_000 }] }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(within(screen.getByTestId('sticky-bar')).getByText('Bạn được miễn phí giao hàng 🌿')).toBeInTheDocument();
    expect(screen.queryByTestId('freeship-bar')).toBeNull();
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
