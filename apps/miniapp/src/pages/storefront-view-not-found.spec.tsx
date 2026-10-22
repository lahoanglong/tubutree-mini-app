import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HttpError } from '../services/http';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), getPublicStorefront: vi.fn(), fetchProducts: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useParams: () => ({ slug: 'khong-co' }),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/s/khong-co', search: '', hash: '', state: null, key: 'k' }),
}));
vi.mock('../services/storefront-api', () => ({ getPublicStorefront: mocks.getPublicStorefront }));
vi.mock('../services/shop-api', () => ({ fetchProducts: mocks.fetchProducts, fetchActiveFlashSales: vi.fn().mockResolvedValue([]) }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import StorefrontViewPage from './storefront-view';

const notFound = () => new HttpError('nf', '404', { status: 404, data: {} });

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StorefrontViewPage />
    </QueryClientProvider>,
  );
}

describe('StorefrontViewPage — gian hàng không tồn tại (cửa vào của link CTV)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchProducts.mockResolvedValue({
      data: [{ id: 'g1', slug: 'g1', brand: 'Tubu', name: 'Gợi ý một', thumbnail: null, basePrice: 90_000, salePrice: null, isFeatured: false, inStock: true }],
      meta: { page: 1, limit: 4, total: 1 },
    });
  });

  it('404: có tiêu đề trang h1, nói rõ gian hàng không còn, nút "Về trang chủ" (không có "Thử lại" vô ích) và kệ "Có thể bạn thích"', async () => {
    mocks.getPublicStorefront.mockRejectedValue(notFound());
    renderPage();
    expect(await screen.findByText('Gian hàng này không tồn tại hoặc đã ngừng hoạt động.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Gian hàng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Về trang chủ' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/');
    expect(await screen.findByRole('heading', { level: 2, name: 'Có thể bạn thích' })).toBeInTheDocument();
    expect(screen.getByText('Gợi ý một')).toBeInTheDocument();
  });

  it('lỗi mạng: vẫn có h1 và "Thử lại" (thử lại có thể khỏi), không có kệ gợi ý', async () => {
    mocks.getPublicStorefront.mockRejectedValueOnce(new Error('mạng')).mockResolvedValue(undefined);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Gian hàng' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Có thể bạn thích' })).toBeNull();
  });
});
