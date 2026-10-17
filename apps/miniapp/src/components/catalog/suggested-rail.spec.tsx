import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductCard } from '../../services/shop-api';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchProducts: vi.fn(), fetchActiveFlashSales: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchProducts: mocks.fetchProducts, fetchActiveFlashSales: mocks.fetchActiveFlashSales }));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { SuggestedRail } from './suggested-rail';

const product = (id: string, over: Partial<ProductCard> = {}): ProductCard => ({
  id, slug: `sp-${id}`, brand: 'Tubu', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true, ...over,
});

function renderRail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SuggestedRail listSource="cart_empty" />
    </QueryClientProvider>,
  );
}

describe('SuggestedRail — kệ "Có thể bạn thích" ở màn rỗng/không tìm thấy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
  });

  it('hỏi SP bán chạy, hiện dưới tiêu đề h2 "Có thể bạn thích"', async () => {
    mocks.fetchProducts.mockResolvedValue({ data: [product('1'), product('2')], meta: { page: 1, limit: 4, total: 2 } });
    renderRail();
    expect(await screen.findByRole('heading', { level: 2, name: 'Có thể bạn thích' })).toBeInTheDocument();
    expect(screen.getByText('Sản phẩm 1')).toBeInTheDocument();
    expect(screen.getByText('Sản phẩm 2')).toBeInTheDocument();
    expect(mocks.fetchProducts).toHaveBeenCalledWith({ limit: 4, sort: 'best_seller' });
  });

  it('bỏ SP hết hàng khỏi gợi ý', async () => {
    mocks.fetchProducts.mockResolvedValue({ data: [product('1'), product('2', { inStock: false })], meta: { page: 1, limit: 4, total: 2 } });
    renderRail();
    await screen.findByText('Sản phẩm 1');
    expect(screen.queryByText('Sản phẩm 2')).toBeNull();
  });

  it('lỗi tải hoặc không có SP nào → không vẽ gì (màn rỗng/lỗi bên trên đã đủ nói)', async () => {
    mocks.fetchProducts.mockRejectedValue(new Error('boom'));
    const first = renderRail();
    await vi.waitFor(() => expect(mocks.fetchProducts).toHaveBeenCalled());
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();
    mocks.fetchProducts.mockResolvedValue({ data: [], meta: { page: 1, limit: 4, total: 0 } });
    const second = renderRail();
    await vi.waitFor(() => expect(mocks.fetchProducts).toHaveBeenCalledTimes(2));
    expect(second.container).toBeEmptyDOMElement();
  });
});
