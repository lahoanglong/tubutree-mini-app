import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getWishlist: vi.fn(),
  authStatus: 'authenticated' as string,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/wishlist', search: '', state: null }),
}));
vi.mock('../services/wishlist-api', () => ({ getWishlist: mocks.getWishlist }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.authStatus }),
}));
vi.mock('../components/product-card', () => ({
  default: ({ product }: { product: { id: string; name: string } }) => <div data-testid="product-card">{product.name}</div>,
}));

import WishlistPage from './wishlist';

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
