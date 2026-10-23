import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
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
    return null;
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

  it('hết hàng hẳn → báo hết hàng thay vì "Chỉ còn 0 sản phẩm"', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, quantity: 1, stock: 0 }] }));
    renderPage();
    expect(await screen.findByText('Sản phẩm đã hết hàng')).toBeInTheDocument();
    expect(screen.queryByText('Chỉ còn 0 sản phẩm')).toBeNull();
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
      expect(screen.getByText('Tạm tính (đã giảm, chưa gồm phí giao hàng)').parentElement).toHaveTextContent('75.000đ');
      expect(screen.getByText('Tạm tính (đã giảm, chưa gồm phí giao hàng)').parentElement).not.toHaveTextContent('233.000đ');
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
