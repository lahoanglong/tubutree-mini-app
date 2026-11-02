import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bảng chọn THẬT (không thay bằng bản rút gọn như wishlist.spec): thêm nhanh từ Yêu thích dùng cùng VariationSheet với trang chi tiết,
// nên nút "Thêm vào giỏ" phải ghi đúng số tiền giỏ tăng khi giỏ đã có sẵn cùng phân loại (máy chủ giá Giờ vàng trên cả dòng).
const mocks = vi.hoisted(() => ({
  getWishlist: vi.fn(),
  fetchProduct: vi.fn(),
  addToCart: vi.fn(),
  getCart: vi.fn(),
  flash: vi.fn(),
  snackbar: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/wishlist', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.snackbar }),
}));
vi.mock('../services/shop-api', () => ({
  fetchProduct: mocks.fetchProduct,
  addToCart: mocks.addToCart,
  getCart: mocks.getCart,
  fetchActiveFlashSales: mocks.flash,
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../services/wishlist-api', () => ({ getWishlist: mocks.getWishlist }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }),
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

const variation = (id: string, retailPrice: number, stock = 245) => ({ id, name: `Loại ${id}`, sku: id, attributes: {}, retailPrice, salePrice: null, stock });
const detail = { id: 'p1', slug: 'khan-uot', name: 'Khăn ướt', thumbnail: null, variations: [variation('var-1', 35_000), variation('var-2', 20_000)] };
const FLASH = [{ productSlug: 'khan-uot', variationId: 'var-1', flashPrice: 26_000, perUserLimit: 3 }];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WishlistPage />
    </QueryClientProvider>,
  );
}

async function openSheet() {
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm Khăn ướt vào giỏ' }));
  await screen.findByTestId('variation-sheet-price');
}
const confirmButton = () => screen.getByRole('button', { name: /^Thêm vào giỏ/ });

describe('Trang Yêu thích: bảng Thêm nhanh đọc giỏ để ghi đúng tiền', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWishlist.mockResolvedValue([{ id: 'p1', slug: 'khan-uot', name: 'Khăn ướt', inStock: true, repVariationId: 'var-1' }]);
    mocks.fetchProduct.mockResolvedValue(detail);
    mocks.flash.mockResolvedValue(FLASH);
    mocks.addToCart.mockResolvedValue({ items: [], itemCount: 0 });
    mocks.getCart.mockResolvedValue({ items: [], itemCount: 0 });
  });

  it('ví dụ reviewer (giới hạn 3, giỏ có 2 gói var-1, chọn 2): nút ghi phần giỏ tăng 88.000đ, không phải 52.000đ', async () => {
    mocks.getCart.mockResolvedValue({ items: [{ id: 'l1', variationId: 'var-1', quantity: 2 }], itemCount: 2 });
    renderPage();
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    await waitFor(() => expect(confirmButton()).toHaveTextContent('Thêm vào giỏ · 88.000đ'));
    expect(screen.getByRole('status')).toHaveTextContent('Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.');
  });

  it('giỏ đang đúng giới hạn (3), thêm nhanh 1: nút ghi 62.000đ (4 × 35.000 − 3 × 26.000), không phải 26.000đ', async () => {
    mocks.getCart.mockResolvedValue({ items: [{ id: 'l1', variationId: 'var-1', quantity: 3 }], itemCount: 3 });
    renderPage();
    await openSheet();
    await waitFor(() => expect(confirmButton()).toHaveTextContent('Thêm vào giỏ · 62.000đ'));
    expect(screen.getByRole('status')).toHaveTextContent('Giỏ đã có 3. Thêm 1 thì cả 4 sản phẩm tính giá thường.');
  });

  it('giỏ rỗng hoặc chỉ có phân loại khác: số như trước (1 × giá Giờ vàng, không ghi chú)', async () => {
    mocks.getCart.mockResolvedValue({ items: [{ id: 'l2', variationId: 'var-2', quantity: 9 }], itemCount: 9 });
    renderPage();
    await openSheet();
    await waitFor(() => expect(confirmButton()).toHaveTextContent('Thêm vào giỏ · 26.000đ'));
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('giỏ lỗi: coi như rỗng, bảng vẫn mở và nút vẫn bấm được', async () => {
    mocks.getCart.mockRejectedValue(new Error('boom'));
    renderPage();
    await openSheet();
    await waitFor(() => expect(confirmButton()).toHaveTextContent('Thêm vào giỏ · 26.000đ'));
    expect(confirmButton()).not.toBeDisabled();
  });
});
