import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getWishlist: vi.fn(),
  authStatus: 'authenticated' as string,
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  snackbar: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/wishlist', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.snackbar }),
}));
vi.mock('../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  addToCart: mocks.addToCart,
  fetchActiveFlashSales: async () => [],
}));
vi.mock('../components/variation-sheet', () => ({
  VariationSheet: (p: { open: boolean; variations: { id: string }[]; onConfirm: (v: { id: string }, qty: number) => void }) =>
    p.open ? (
      <div data-testid="variation-sheet">
        <button type="button" onClick={() => p.onConfirm(p.variations[1]!, 2)}>
          xác nhận phân loại
        </button>
      </div>
    ) : null,
}));
vi.mock('../services/wishlist-api', () => ({ getWishlist: mocks.getWishlist }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.authStatus }),
}));
vi.mock('../components/product-card', () => ({
  default: ({ product, imageOverlay }: { product: { id: string; name: string }; imageOverlay?: ReactNode }) => (
    <div data-testid="product-card">
      {product.name}
      {imageOverlay}
    </div>
  ),
}));

import WishlistPage from './wishlist';
import { QUICK_ADD_SOLD_OUT } from '@tubutree/app-core/quick-add';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WishlistPage />
    </QueryClientProvider>,
  );
}

describe('Trang Yêu thích', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getWishlist.mockResolvedValue([]);
  });

  it('chưa đăng nhập xong thì chưa gọi API (tránh 401 thành màn lỗi) và hiện khung chờ', () => {
    mocks.authStatus = 'loading';
    const { container } = renderPage();
    expect(mocks.getWishlist).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.tubu-skeleton').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('có sản phẩm: mỗi sản phẩm một thẻ, đúng một h1 "Sản phẩm yêu thích"', async () => {
    mocks.getWishlist.mockResolvedValue([
      { id: 'p1', name: 'Xà bông thảo mộc' },
      { id: 'p2', name: 'Dầu gội bồ kết' },
    ]);
    renderPage();
    expect(await screen.findAllByTestId('product-card')).toHaveLength(2);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sản phẩm yêu thích');
  });

  it('danh sách trống: lời nhắc không dùng ký tự ♡ làm icon, nút Khám phá mở /browse', async () => {
    renderPage();
    expect(await screen.findByText('Chưa có sản phẩm yêu thích')).toBeInTheDocument();
    expect(screen.getByText(/trái tim trên sản phẩm để lưu lại xem sau/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('♡');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Khám phá sản phẩm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('lỗi tải: vẫn một h1, "Thử lại" gọi lại API', async () => {
    mocks.getWishlist.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([{ id: 'p1', name: 'Xà bông' }]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.getWishlist).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByTestId('product-card')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('Trang Yêu thích: nút giỏ nhanh', () => {
  const variation = (id: string, stock = 5) => ({ id, name: `Loại ${id}`, sku: id, attributes: {}, retailPrice: 100000, salePrice: null, stock });
  const detail = (variations: ReturnType<typeof variation>[]) => ({ id: 'p1', slug: 'xa-bong', name: 'Xà bông', thumbnail: null, variations });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.addToCart.mockResolvedValue({ items: [] });
    mocks.getWishlist.mockResolvedValue([
      { id: 'p1', slug: 'xa-bong', name: 'Xà bông', inStock: true },
      { id: 'p2', slug: 'het-hang', name: 'Dầu gội', inStock: false },
    ]);
  });

  it('chỉ thẻ còn hàng có nút, nút có tên đọc màn hình theo sản phẩm và vùng chạm 44px', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' });
    expect(screen.queryByRole('button', { name: 'Thêm Dầu gội vào giỏ' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /vào giỏ/ })).toHaveLength(1);
    expect(btn.style.width).toBe('44px');
    expect(btn.style.height).toBe('44px');
  });

  it('một phân loại: thêm thẳng 1 sản phẩm với nguồn wishlist, không mở bảng chọn', async () => {
    mocks.fetchProduct.mockResolvedValue(detail([variation('v1')]));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1, 'wishlist'));
    expect(mocks.fetchProduct).toHaveBeenCalledWith('xa-bong');
    expect(screen.queryByTestId('variation-sheet')).toBeNull();
    expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('nhiều phân loại: mở bảng chọn phân loại, chỉ thêm khi khách xác nhận', async () => {
    mocks.fetchProduct.mockResolvedValue(detail([variation('v1'), variation('v2')]));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' }));
    expect(await screen.findByTestId('variation-sheet')).toBeInTheDocument();
    expect(mocks.addToCart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'xác nhận phân loại' }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v2', 2, 'wishlist'));
    await waitFor(() => expect(screen.queryByTestId('variation-sheet')).toBeNull());
  });

  it('hết hàng ngay lúc bấm (tồn đã đổi): báo cho khách, không gọi thêm giỏ', async () => {
    mocks.fetchProduct.mockResolvedValue(detail([variation('v1', 0)]));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' }));
    await waitFor(() => expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('hết hàng ngay lúc bấm: cùng lời báo với web (không hứa hàng về) và tải lại danh sách để thẻ hiện "Hết hàng"', async () => {
    mocks.fetchProduct.mockResolvedValue(detail([variation('v1', 0)]));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' }));
    await waitFor(() => expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ text: QUICK_ADD_SOLD_OUT, type: 'error' })));
    expect(QUICK_ADD_SOLD_OUT).toBe('Sản phẩm vừa hết hàng. Bạn xem sản phẩm khác nhé.');
    await waitFor(() => expect(mocks.getWishlist).toHaveBeenCalledTimes(2));
  });

  it('thêm giỏ lỗi: báo lỗi cho khách và nút bấm lại được', async () => {
    mocks.fetchProduct.mockResolvedValue(detail([variation('v1')]));
    mocks.addToCart.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' }));
    await waitFor(() => expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(screen.getByRole('button', { name: 'Thêm Xà bông vào giỏ' })).not.toBeDisabled();
  });
});
