import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getWishlist: vi.fn(),
  authStatus: 'authenticated' as string,
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  getCart: vi.fn(),
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
  getCart: mocks.getCart,
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
vi.mock('../components/ui/product-card', () => ({
  ProductCard: ({ product, imageOverlay }: { product: { id: string; name: string }; imageOverlay?: ReactNode }) => (
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
    mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
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
    mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
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

describe('Trang Yêu thích: bộ lọc nhanh', () => {
  const item = (id: string, name: string, salePrice: number | null, inStock: boolean) => ({ id, slug: `sp-${id}`, name, basePrice: 100000, salePrice, inStock });
  const MIXED = [item('a', 'Nước rửa chén', 80000, true), item('b', 'Xà phòng', null, true), item('c', 'Dầu gội', 70000, false), item('d', 'Nước giặt', null, false)];
  const chip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });
  const names = () => screen.queryAllByTestId('product-card').map((n) => n.textContent ?? '');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
    mocks.getWishlist.mockResolvedValue(MIXED);
  });

  it('có món: ba chip Tất cả, Đang giảm, Còn hàng kèm số đếm, Tất cả đang chọn và hiện đủ thẻ', async () => {
    renderPage();
    expect(await screen.findAllByTestId('product-card')).toHaveLength(4);
    expect(screen.getByRole('region', { name: 'Lọc sản phẩm yêu thích' })).toBeInTheDocument();
    expect(['Tất cả', 'Đang giảm', 'Còn hàng'].map((l) => chip(l).textContent)).toEqual(['Tất cả(4)', 'Đang giảm(2)', 'Còn hàng(2)']);
    expect(chip('Tất cả')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Đang giảm')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('Còn hàng')).toHaveAttribute('aria-pressed', 'false');
  });

  it('chip có vùng chạm 44px (tubu-hit-44, rộng tối thiểu 44px)', async () => {
    renderPage();
    await screen.findAllByTestId('product-card');
    for (const l of ['Tất cả', 'Đang giảm', 'Còn hàng']) {
      expect(chip(l).className).toContain('tubu-hit-44');
      expect(chip(l).style.minWidth).toBe('44px');
    }
  });

  it('chọn Đang giảm: chỉ món có giá gạch, số đếm trên chip không đổi; chọn Còn hàng: chỉ món còn hàng', async () => {
    renderPage();
    await screen.findAllByTestId('product-card');
    fireEvent.click(chip('Đang giảm'));
    expect(names().map((t) => t.replace(/Thêm.*/, ''))).toEqual(['Nước rửa chén', 'Dầu gội']);
    expect(chip('Đang giảm')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Tất cả')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('Tất cả').textContent).toBe('Tất cả(4)');
    fireEvent.click(chip('Còn hàng'));
    expect(names()).toHaveLength(2);
    expect(names().join('|')).toContain('Nước rửa chén');
    expect(names().join('|')).toContain('Xà phòng');
    expect(names().join('|')).not.toContain('Dầu gội');
    fireEvent.click(chip('Tất cả'));
    expect(names()).toHaveLength(4);
  });

  it('lọc ra rỗng: câu báo theo bộ lọc kèm nút về Tất cả; chip vẫn còn để đổi bộ lọc', async () => {
    mocks.getWishlist.mockResolvedValue([item('a', 'Nước rửa chén', null, true), item('b', 'Xà phòng', 100000, true)]);
    renderPage();
    await screen.findAllByTestId('product-card');
    fireEvent.click(chip('Đang giảm'));
    expect(screen.queryAllByTestId('product-card')).toHaveLength(0);
    expect(screen.getByText('Chưa có sản phẩm đang giảm giá trong danh sách yêu thích')).toBeInTheDocument();
    expect(screen.queryByText('Chưa có sản phẩm yêu thích')).toBeNull();
    expect(chip('Đang giảm').textContent).toBe('Đang giảm(0)');
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả sản phẩm đã lưu' }));
    expect(screen.getAllByTestId('product-card')).toHaveLength(2);
    expect(chip('Tất cả')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Chưa có sản phẩm đang giảm giá trong danh sách yêu thích')).toBeNull();
  });

  it('không món nào còn hàng: Còn hàng ra câu báo riêng', async () => {
    mocks.getWishlist.mockResolvedValue([item('a', 'Nước rửa chén', null, false)]);
    renderPage();
    await screen.findAllByTestId('product-card');
    fireEvent.click(chip('Còn hàng'));
    expect(screen.getByText('Chưa có sản phẩm còn hàng trong danh sách yêu thích')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xem tất cả sản phẩm đã lưu' })).toBeInTheDocument();
  });

  it('danh sách về rỗng khi đang lọc rồi có món lại: bộ lọc về Tất cả, không mở ở bộ lọc cũ', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <WishlistPage />
      </QueryClientProvider>,
    );
    await screen.findAllByTestId('product-card');
    fireEvent.click(chip('Đang giảm'));
    mocks.getWishlist.mockResolvedValue([]);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['wishlist'] });
    });
    expect(await screen.findByText('Chưa có sản phẩm yêu thích')).toBeInTheDocument();
    mocks.getWishlist.mockResolvedValue(MIXED);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['wishlist'] });
    });
    await waitFor(() => expect(screen.getAllByTestId('product-card')).toHaveLength(4));
    expect(chip('Tất cả')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Chưa có sản phẩm đang giảm giá trong danh sách yêu thích')).toBeNull();
  });

  it('danh sách yêu thích trống hoặc lỗi tải: không có dải lọc', async () => {
    mocks.getWishlist.mockResolvedValue([]);
    const first = renderPage();
    expect(await screen.findByText('Chưa có sản phẩm yêu thích')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Lọc sản phẩm yêu thích' })).toBeNull();
    first.unmount();
    mocks.getWishlist.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Lọc sản phẩm yêu thích' })).toBeNull();
  });

  it('thẻ trong danh sách đã lọc vẫn có nút giỏ nhanh cho món còn hàng', async () => {
    renderPage();
    await screen.findAllByTestId('product-card');
    fireEvent.click(chip('Đang giảm'));
    expect(screen.getByRole('button', { name: 'Thêm Nước rửa chén vào giỏ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thêm Dầu gội vào giỏ' })).toBeNull();
  });
});
