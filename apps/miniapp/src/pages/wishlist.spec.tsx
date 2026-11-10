import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getWishlist: vi.fn(),
  authStatus: 'authenticated' as string,
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  getCart: vi.fn(),
  fetchFlash: vi.fn(async (): Promise<unknown[]> => []),
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
  fetchActiveFlashSales: () => mocks.fetchFlash(),
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
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';
import { QUICK_ADD_SOLD_OUT } from '@tubutree/app-core/quick-add';

let lastClient: QueryClient;
function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastClient = qc;
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

describe('Trang Yêu thích: Đang giảm theo Giờ vàng', () => {
  const item = (id: string, name: string, salePrice: number | null, inStock: boolean) => ({ id, slug: `sp-${id}`, name, basePrice: 100000, salePrice, inStock });
  const MIXED = [item('a', 'Nước rửa chén', 80000, true), item('b', 'Xà phòng', null, true), item('c', 'Dầu gội', 70000, false), item('d', 'Nước giặt', null, false)];
  const chip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });
  const names = () => screen.queryAllByTestId('product-card').map((n) => (n.textContent ?? '').replace(/Thêm.*/, ''));
  // Chờ danh sách Giờ vàng thật sự vào bộ nhớ truy vấn (mới "đã gọi" thì số đếm chưa thể dùng nó).
  const flashLanded = () => waitFor(() => expect(lastClient.getQueryData(['flash-sales', 'active'])).toBeDefined());
  const flashFor = (slug: string, endAfterMs: number, flashPrice = 60000) => ({
    productSlug: slug,
    variationId: `v-${slug}`,
    flashPrice,
    endAt: new Date(Date.now() + endAfterMs).toISOString(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
    mocks.getWishlist.mockResolvedValue(MIXED);
  });
  afterEach(() => {
    vi.useRealTimers();
    mocks.fetchFlash.mockResolvedValue([]);
  });

  it('món chỉ giảm nhờ Giờ vàng được đếm và hiện ở Đang giảm; Tất cả và Còn hàng không đổi', async () => {
    mocks.fetchFlash.mockResolvedValue([flashFor('sp-b', 3_600_000)]);
    renderPage();
    await screen.findAllByTestId('product-card');
    await waitFor(() => expect(chip('Đang giảm').textContent).toBe('Đang giảm(3)'));
    expect(chip('Tất cả').textContent).toBe('Tất cả(4)');
    expect(chip('Còn hàng').textContent).toBe('Còn hàng(2)');
    fireEvent.click(chip('Đang giảm'));
    expect(names()).toEqual(['Nước rửa chén', 'Xà phòng', 'Dầu gội']);
  });

  it('suất đã hết hạn, suất không rẻ hơn giá bán và suất của sản phẩm khác không làm món thành đang giảm; suất hợp lệ của món khác vẫn được đếm', async () => {
    mocks.getWishlist.mockResolvedValue([...MIXED, item('e', 'Khăn giấy', null, true)]);
    mocks.fetchFlash.mockResolvedValue([flashFor('sp-b', -1_000), flashFor('sp-c', 3_600_000, 100000), flashFor('sp-khac', 3_600_000), flashFor('sp-e', 3_600_000)]);
    renderPage();
    await screen.findAllByTestId('product-card');
    await flashLanded();
    await waitFor(() => expect(chip('Đang giảm').textContent).toBe('Đang giảm(3)'));
    fireEvent.click(chip('Đang giảm'));
    expect(names()).toEqual(['Nước rửa chén', 'Dầu gội', 'Khăn giấy']);
  });

  it('lọc ra rỗng chỉ vì suất Giờ vàng đã hết hạn: có câu báo và nút về Tất cả', async () => {
    mocks.getWishlist.mockResolvedValue([item('b', 'Xà phòng', null, true)]);
    mocks.fetchFlash.mockResolvedValue([flashFor('sp-b', -1_000)]);
    renderPage();
    await screen.findAllByTestId('product-card');
    await flashLanded();
    fireEvent.click(chip('Đang giảm'));
    expect(screen.getByText('Chưa có sản phẩm đang giảm giá trong danh sách yêu thích')).toBeInTheDocument();
  });

  it('suất hết giờ khi khách còn đang xem: số đếm và lưới tự bỏ món, không cần tải lại', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.fetchFlash.mockResolvedValue([flashFor('sp-b', 5_000)]);
    renderPage();
    await screen.findAllByTestId('product-card');
    await waitFor(() => expect(chip('Đang giảm').textContent).toBe('Đang giảm(3)'));
    fireEvent.click(chip('Đang giảm'));
    expect(names()).toEqual(['Nước rửa chén', 'Xà phòng', 'Dầu gội']);
    act(() => void vi.advanceTimersByTime(6_000));
    await waitFor(() => expect(chip('Đang giảm').textContent).toBe('Đang giảm(2)'));
    expect(names()).toEqual(['Nước rửa chén', 'Dầu gội']);
  });

  it('chỉ đọc Giờ vàng khi danh sách có món (không gọi khi trống), dùng đúng một truy vấn', async () => {
    mocks.getWishlist.mockResolvedValue([]);
    const first = renderPage();
    expect(await screen.findByText('Chưa có sản phẩm yêu thích')).toBeInTheDocument();
    expect(mocks.fetchFlash).not.toHaveBeenCalled();
    first.unmount();
    mocks.getWishlist.mockResolvedValue(MIXED);
    renderPage();
    await screen.findAllByTestId('product-card');
    await flashLanded();
    await act(async () => {});
    expect(mocks.fetchFlash).toHaveBeenCalledTimes(1);
  });

  it('"Xem tất cả sản phẩm đã lưu" trả focus bàn phím về chip Tất cả (nút vừa bấm biến mất cùng khối rỗng)', async () => {
    mocks.getWishlist.mockResolvedValue([item('a', 'Nước rửa chén', null, true)]);
    renderPage();
    await screen.findAllByTestId('product-card');
    fireEvent.click(chip('Đang giảm'));
    const cta = screen.getByRole('button', { name: 'Xem tất cả sản phẩm đã lưu' });
    cta.focus();
    fireEvent.click(cta);
    await waitFor(() => expect(chip('Tất cả')).toHaveFocus());
    expect(chip('Tất cả')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Trang Yêu thích: nút giỏ nhanh và bảng chọn phân loại khoá chạm đúp (W76A)', () => {
  const variation = (id: string, stock = 5) => ({ id, name: `Loại ${id}`, sku: id, attributes: {}, retailPrice: 100000, salePrice: null, stock });
  const detail = (variations: ReturnType<typeof variation>[]) => ({ id: 'p1', slug: 'xa-bong', name: 'Xà bông', thumbnail: null, variations });
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const quickBtn = (name = 'Xà bông') => screen.getByRole('button', { name: `Thêm ${name} vào giỏ` });
  const successToasts = () => mocks.snackbar.mock.calls.filter(([a]) => (a as { type: string }).type === 'success');
  const errorToasts = () => mocks.snackbar.mock.calls.filter(([a]) => (a as { type: string }).type === 'error');
  // Mở bảng chọn phân loại (sản phẩm nhiều phân loại) rồi trả nút xác nhận của bảng.
  const openPicker = async () => {
    mocks.fetchProduct.mockResolvedValueOnce(detail([variation('v1'), variation('v2')]));
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' }));
    await screen.findByTestId('variation-sheet');
    return screen.getByRole('button', { name: 'xác nhận phân loại' });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.addToCart.mockResolvedValue({ items: [] });
    mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
    mocks.getWishlist.mockResolvedValue([
      { id: 'p1', slug: 'xa-bong', name: 'Xà bông', inStock: true },
      { id: 'p2', slug: 'dau-goi', name: 'Dầu gội', inStock: true },
    ]);
  });

  it('chạm đúp nút giỏ trong cùng một khung hình chỉ thêm một sản phẩm vào giỏ', async () => {
    const d = deferred();
    mocks.fetchProduct.mockResolvedValue(detail([variation('v1')]));
    mocks.addToCart.mockReturnValueOnce(d.promise);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(1));
    expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1, 'wishlist');
    await act(async () => d.resolve({ items: [] }));
    await waitFor(() => expect(successToasts()).toHaveLength(1));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
  });

  it('đang thêm: nút aria-busy mà không bị disabled (giữ focus), xong thì hết busy', async () => {
    const d = deferred();
    mocks.fetchProduct.mockResolvedValue(detail([variation('v1')]));
    mocks.addToCart.mockReturnValueOnce(d.promise);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' });
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveFocus();
    await act(async () => d.resolve({ items: [] }));
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'false'));
  });

  it('thêm giỏ lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
    mocks.fetchProduct.mockResolvedValue(detail([variation('v1')]));
    mocks.addToCart.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ items: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' }));
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    fireEvent.click(quickBtn());
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(successToasts()).toHaveLength(1));
  });

  it('hai sản phẩm khác nhau bấm sát nhau trong một khung hình: chỉ sản phẩm bấm trước được thêm', async () => {
    const d = deferred();
    mocks.fetchProduct.mockResolvedValue(detail([variation('v1')]));
    mocks.addToCart.mockReturnValueOnce(d.promise);
    renderPage();
    const first = await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' });
    const second = screen.getByRole('button', { name: 'Thêm Dầu gội vào giỏ' });
    await act(async () => {
      fireEvent.click(first);
      fireEvent.click(second);
    });
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(1));
    expect(mocks.fetchProduct).toHaveBeenCalledTimes(1);
    expect(mocks.fetchProduct).toHaveBeenCalledWith('xa-bong');
    await act(async () => d.resolve({ items: [] }));
    await waitFor(() => expect(successToasts()).toHaveLength(1));
  });

  it('chạm đúp "xác nhận phân loại" trong cùng một khung hình chỉ thêm một lần, rồi đóng bảng', async () => {
    const d = deferred();
    mocks.addToCart.mockReturnValueOnce(d.promise);
    renderPage();
    const confirm = await openPicker();
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).toHaveBeenCalledWith('v2', 2, 'wishlist');
    await act(async () => d.resolve({ items: [] }));
    await waitFor(() => expect(screen.queryByTestId('variation-sheet')).toBeNull());
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(successToasts()).toHaveLength(1);
  });

  it('thêm từ bảng chọn lỗi thì giữ bảng, nhả khoá, bấm lại gọi lần hai', async () => {
    mocks.addToCart.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ items: [] });
    renderPage();
    const confirm = await openPicker();
    fireEvent.click(confirm);
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    expect(screen.getByTestId('variation-sheet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'xác nhận phân loại' }));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('variation-sheet')).toBeNull());
  });

  it('xác nhận phân loại rồi bấm nút giỏ nhanh trong một khung hình: chung một khoá, chỉ lệnh thêm từ bảng đi', async () => {
    const d = deferred();
    mocks.addToCart.mockReturnValueOnce(d.promise);
    renderPage();
    const confirm = await openPicker();
    mocks.fetchProduct.mockClear();
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(quickBtn());
    });
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.fetchProduct).not.toHaveBeenCalled();
    await act(async () => d.resolve({ items: [] }));
    await waitFor(() => expect(successToasts()).toHaveLength(1));
  });

  it('bấm nút giỏ nhanh rồi xác nhận phân loại trong một khung hình: chung một khoá, lệnh xác nhận bị bỏ qua', async () => {
    const d = deferred();
    renderPage();
    const confirm = await openPicker();
    mocks.fetchProduct.mockReset();
    mocks.fetchProduct.mockReturnValueOnce(d.promise);
    await act(async () => {
      fireEvent.click(quickBtn());
      fireEvent.click(confirm);
    });
    expect(mocks.fetchProduct).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).not.toHaveBeenCalled();
    await act(async () => d.resolve(detail([variation('v1')])));
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(1));
    expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1, 'wishlist');
  });
});

// W113A: thêm giỏ từ Yêu thích bị máy chủ từ chối vì tồn kho hay sản phẩm đã đổi (400/404/409) thì nút giữ khoá tới khi danh sách tải lại về (tối đa LOCK_REFRESH_WAIT_MS), kẻo bấm lại trên thẻ cũ nhận đúng lỗi đó;
// bảng chọn phân loại (có ô số lượng) đóng khi món không còn (404/409); 400 ("Chỉ còn N") và 422 giữ bảng để giảm số lượng. Mất mạng, quá hạn, 401, 5xx không nói gì về trạng thái thật: không tải lại, nhả ngay, bảng giữ nguyên để thử lại.
describe('Trang Yêu thích: máy chủ từ chối thì giữ khoá tới khi dữ liệu làm mới về (W113A)', () => {
  type Refresh = () => Promise<unknown>;
  const variation = (id: string, stock = 5) => ({ id, name: `Loại ${id}`, sku: id, attributes: {}, retailPrice: 100000, salePrice: null, stock });
  const detail = (variations: ReturnType<typeof variation>[]) => ({ id: 'p1', slug: 'xa-bong', name: 'Xà bông', thumbnail: null, variations });
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorToasts = () => mocks.snackbar.mock.calls.filter(([a]) => (a as { type: string }).type === 'error').length;
  const quickBtn = () => screen.getByRole('button', { name: 'Thêm Xà bông vào giỏ' });
  const busy = () => quickBtn().getAttribute('aria-busy') === 'true';
  const sheet = () => screen.queryByTestId('variation-sheet');
  // TanStack báo cache qua setTimeout(0): đợi một nhịp để trạng thái kịp cập nhật sau khi lệnh xong.
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const renderLive = (refresh: Refresh): MockInstance<QueryClient['invalidateQueries']> => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(
      <QueryClientProvider client={qc}>
        <WishlistPage />
      </QueryClientProvider>,
    );
    return invalidate;
  };

  /** `start` chạm nút giỏ nhanh (và xác nhận ở bảng nếu có): gửi đúng một lệnh thêm giỏ. */
  const FLOWS = [
    {
      name: 'nút giỏ nhanh (một phân loại)',
      picker: false,
      setup: () => mocks.fetchProduct.mockResolvedValue(detail([variation('v1')])),
      start: async () => {
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' }));
      },
    },
    {
      name: 'bảng chọn phân loại',
      picker: true,
      setup: () => mocks.fetchProduct.mockResolvedValue(detail([variation('v1'), variation('v2')])),
      start: async () => {
        fireEvent.click(await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' }));
        await screen.findByTestId('variation-sheet');
        fireEvent.click(screen.getByRole('button', { name: 'xác nhận phân loại' }));
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.addToCart.mockReset();
    mocks.addToCart.mockResolvedValue({ items: [] });
    mocks.fetchProduct.mockReset();
    mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
    mocks.getWishlist.mockResolvedValue([
      { id: 'p1', slug: 'xa-bong', name: 'Xà bông', inStock: true },
      { id: 'p2', slug: 'dau-goi', name: 'Dầu gội', inStock: true },
    ]);
  });

  describe.each(FLOWS)('$name', (f) => {
    beforeEach(() => f.setup());

    it.each([
      [400, 'Chỉ còn 0 sản phẩm'],
      [404, 'Sản phẩm không còn bán'],
      [409, 'Vừa có thay đổi, bạn thử lại nhé'],
    ])('bị từ chối %i: báo lỗi một lần, tải lại danh sách, nút giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
      mocks.addToCart.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue({ items: [] });
      const refresh = deferred();
      const invalidate = renderLive(() => refresh.promise);
      await f.start();
      await waitFor(() => expect(errorToasts()).toBe(1));
      expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ text: message, type: 'error' }));
      expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['wishlist'] }]);
      // Món không còn (404/409): bảng chọn đóng ngay, không đợi dữ liệu về. 400 ("Chỉ còn N"): bảng giữ để đổi số lượng. Nút giỏ vẫn bận cả hai.
      if (f.picker && status !== 400) await waitFor(() => expect(sheet()).toBeNull());
      if (f.picker && status === 400) expect(sheet()).not.toBeNull();
      expect(busy()).toBe(true);
      await act(async () => {
        fireEvent.click(quickBtn());
        fireEvent.click(quickBtn());
      });
      expect(mocks.addToCart).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      await waitFor(() => expect(busy()).toBe(false));
      expect(errorToasts()).toBe(1);
      await f.start();
      await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    });

    it('bị từ chối 422: giữ bảng chọn (nếu có), không tải lại, nhả ngay', async () => {
      mocks.addToCart.mockRejectedValueOnce(serverError('Dữ liệu không hợp lệ', 422)).mockResolvedValue({ items: [] });
      const invalidate = renderLive(() => new Promise(() => undefined));
      await f.start();
      await waitFor(() => expect(errorToasts()).toBe(1));
      await waitFor(() => expect(busy()).toBe(false));
      if (f.picker) expect(sheet()).not.toBeNull();
      expect(invalidate).not.toHaveBeenCalled();
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ])('%s: không giữ khoá chờ tải lại, khoá nhả ngay, bảng chọn giữ nguyên', async (_label, error) => {
      mocks.addToCart.mockRejectedValueOnce(error).mockResolvedValue({ items: [] });
      const invalidate = renderLive(() => new Promise(() => undefined));
      await f.start();
      await waitFor(() => expect(errorToasts()).toBe(1));
      await waitFor(() => expect(busy()).toBe(false));
      expect(invalidate).not.toHaveBeenCalled();
      if (f.picker) expect(sheet()).not.toBeNull();
      await f.start();
      await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    });

    it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      mocks.addToCart.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue({ items: [] });
      renderLive(() => new Promise(() => undefined));
      await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await f.start();
        await waitFor(() => expect(errorToasts()).toBe(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
        });
        expect(busy()).toBe(true);
        await act(async () => {
          fireEvent.click(quickBtn());
        });
        expect(mocks.addToCart).toHaveBeenCalledTimes(1);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
        await waitFor(() => expect(busy()).toBe(false));
      } finally {
        vi.useRealTimers();
      }
      await f.start();
      await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledTimes(2));
    });
  });

  describe('chi tiết món lúc bấm báo không còn (404 ở bước tải chi tiết)', () => {
    it('báo lỗi một lần, tải lại danh sách và giữ khoá tới khi dữ liệu về; không gọi thêm giỏ', async () => {
      mocks.fetchProduct.mockRejectedValueOnce(serverError('Không tìm thấy sản phẩm', 404)).mockResolvedValue(detail([variation('v1')]));
      const refresh = deferred();
      const invalidate = renderLive(() => refresh.promise);
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' }));
      await waitFor(() => expect(errorToasts()).toBe(1));
      expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['wishlist'] }]);
      expect(busy()).toBe(true);
      await act(async () => {
        fireEvent.click(quickBtn());
      });
      expect(mocks.fetchProduct).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      await waitFor(() => expect(busy()).toBe(false));
      expect(mocks.addToCart).not.toHaveBeenCalled();
    });

    it('mất mạng ở bước tải chi tiết: không tải lại danh sách, nhả ngay', async () => {
      mocks.fetchProduct.mockRejectedValueOnce(new HttpError('Network Error', 'ERR_NETWORK'));
      const invalidate = renderLive(() => new Promise(() => undefined));
      fireEvent.click(await screen.findByRole('button', { name: 'Thêm Xà bông vào giỏ' }));
      await waitFor(() => expect(errorToasts()).toBe(1));
      await waitFor(() => expect(busy()).toBe(false));
      expect(invalidate).not.toHaveBeenCalled();
    });
  });
});
