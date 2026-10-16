import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getCart: vi.fn(),
  removeCartItem: vi.fn(),
  voucherProps: [] as Record<string, unknown>[],
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
  removeCartItem: mocks.removeCartItem,
  updateCartItem: vi.fn(),
  addToCart: vi.fn(),
}));
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

  it('giỏ toàn hàng Tubu: không có tiêu đề nơi giao, ngưỡng miễn phí ship như cũ', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [{ ...OK_LINE, fulfiller: TUBU }] }));
    renderPage();
    await screen.findByText('Xà bông thảo mộc');
    expect(screen.queryByRole('heading', { level: 2, name: 'Tubu Tree giao' })).toBeNull();
    expect(screen.getByText('Mua thêm 150.000đ để được miễn phí ship')).toBeInTheDocument();
  });

  it('có hàng gian hàng tự giao: mỗi nơi giao một nhóm (Tubu trước), báo tách đơn; ngưỡng miễn phí ship chỉ tính phần Tubu', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [HONEY, { ...OK_LINE, fulfiller: TUBU }], subtotal: 200_000, freeship: true }));
    renderPage();
    await screen.findByText('Mật ong rừng');
    const sections = screen.getAllByRole('region');
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['Tubu Tree giao', 'Mật ong Linh giao']);
    expect(screen.getByRole('heading', { level: 2, name: 'Mật ong Linh giao' })).toBeInTheDocument();
    expect(screen.getByText(/mỗi nơi giao thành một đơn riêng/)).toBeInTheDocument();
    expect(screen.getByText('Mua thêm 150.000đ để được miễn phí ship cho phần hàng Tubu Tree giao')).toBeInTheDocument();
  });

  it('chỉ có hàng gian hàng tự giao: không mời mua thêm để được miễn phí ship', async () => {
    mocks.getCart.mockResolvedValue(summary({ items: [HONEY], subtotal: 150_000 }));
    renderPage();
    await screen.findByText('Mật ong rừng');
    expect(screen.queryByText(/miễn phí ship/)).toBeNull();
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
