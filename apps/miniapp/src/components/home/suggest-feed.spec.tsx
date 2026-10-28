import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ZmpUi from 'zmp-ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchProducts: vi.fn(), fetchForYou: vi.fn(), authStatus: 'guest' as string }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => vi.fn() }));
vi.mock('../../services/shop-api', () => ({
  fetchProducts: mocks.fetchProducts,
  fetchForYou: mocks.fetchForYou,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.authStatus }),
}));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { SuggestFeed } from './suggest-feed';

const card = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true,
});
const page = (data: unknown[]) => ({ data, meta: { page: 1, limit: 12, total: data.length } });

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SuggestFeed />
    </QueryClientProvider>,
  );

describe('SuggestFeed (Mini App)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'guest';
    mocks.fetchForYou.mockResolvedValue([]);
  });

  it('đã tải xong, rỗng, không lỗi → ẩn cả khối: không tiêu đề, không chip', async () => {
    mocks.fetchProducts.mockResolvedValue(page([]));
    const { container } = mount();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole('heading', { name: 'Gợi ý cho bạn' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bán chạy' })).toBeNull();
  });

  it('đang tải → vẫn giữ tiêu đề, chip và khung chờ (trang không nhảy)', () => {
    mocks.fetchProducts.mockReturnValue(new Promise(() => undefined));
    mount();
    expect(screen.getByRole('heading', { name: 'Gợi ý cho bạn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bán chạy' })).toBeInTheDocument();
    expect(screen.getByTestId('catalog-grid-skeleton')).toBeInTheDocument();
  });

  it('có sản phẩm → tiêu đề, chip và lưới', async () => {
    mocks.fetchProducts.mockResolvedValue(page([card(1), card(2)]));
    mount();
    expect(await screen.findByRole('button', { name: 'Sản phẩm 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Gợi ý cho bạn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bán chạy' })).toBeInTheDocument();
  });

  it('lỗi tải (không phải rỗng) → vẫn hiện khối lỗi kèm "Thử lại", không mất khối im lặng', async () => {
    mocks.fetchProducts.mockRejectedValue(new Error('x'));
    mount();
    expect(await screen.findByRole('button', { name: /Thử lại/ })).toBeInTheDocument();
    expect(screen.getByTestId('home-block-error')).toBeInTheDocument();
  });
});
