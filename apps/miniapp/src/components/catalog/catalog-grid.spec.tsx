import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProductCard } from '../../services/shop-api';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchActiveFlashSales: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchActiveFlashSales: mocks.fetchActiveFlashSales }));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { CatalogGrid, CatalogGridSkeleton } from './catalog-grid';

const SALE: ProductCard = { id: 'p1', slug: 'nrc', brand: 'Tubu', name: 'Nước rửa chén', thumbnail: null, basePrice: 150000, salePrice: 120000, isFeatured: false, inStock: true };
const OOS: ProductCard = { ...SALE, id: 'p2', slug: 'het', name: 'Hết hàng', inStock: false };

function renderGrid(onOpen?: (p: ProductCard, i: number) => void, products: ProductCard[] = [SALE, OOS]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CatalogGrid products={products} listSource="search" onOpen={onOpen} />
    </QueryClientProvider>,
  );
}

describe('CatalogGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
  });

  it('2 thẻ; thẻ sale có badge -20%; thẻ hết hàng KHÔNG có badge % (lớp phủ trong suốt)', async () => {
    renderGrid();
    const grid = screen.getByTestId('catalog-grid');
    expect(grid.querySelectorAll('[role="button"][aria-label]')).toHaveLength(2);
    expect(await screen.findByText('-20%')).toBeInTheDocument();
    expect(screen.getAllByText(/-\d+%/)).toHaveLength(1);
  });

  it('API cũ không trả inStock (undefined) → coi là còn hàng: vẫn có badge, không lớp phủ hết hàng', async () => {
    const legacy = { ...SALE, id: 'p3', slug: 'cu', name: 'Hàng cũ' } as Partial<ProductCard>;
    delete legacy.inStock;
    renderGrid(undefined, [legacy as ProductCard]);
    expect(await screen.findByText('-20%')).toBeInTheDocument();
    expect(screen.queryByText(/hết hàng/i)).not.toBeInTheDocument();
  });

  it('chạm thẻ → onOpen(sp, vị trí) TRƯỚC, rồi sang PDP kèm listSource', () => {
    const onOpen = vi.fn();
    renderGrid(onOpen);
    fireEvent.click(screen.getByRole('button', { name: 'Hết hàng' }));
    expect(onOpen).toHaveBeenCalledWith(OOS, 1);
    expect(onOpen.mock.invocationCallOrder[0]!).toBeLessThan(mocks.navigate.mock.invocationCallOrder[0]!);
    expect(mocks.navigate).toHaveBeenCalledWith('/product/het', { state: { listSource: 'search' } });
  });

  it('bàn phím: Tab tới được thẻ, Enter và Space đều mở sản phẩm', () => {
    renderGrid();
    const tile = screen.getByRole('button', { name: 'Nước rửa chén' });
    expect(tile.tabIndex).toBe(0);
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(tile, { key: ' ' });
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).toHaveBeenLastCalledWith('/product/nrc', { state: { listSource: 'search' } });
  });

  it('tên truy cập của thẻ là tên sản phẩm, giá nằm trong mô tả truy cập', () => {
    renderGrid();
    const tile = screen.getByRole('button', { name: 'Nước rửa chén' });
    expect(tile).toHaveAccessibleDescription(/120\.000/);
  });

  it('đang giờ vàng → giá flash, badge giờ vàng, mở đúng phân loại', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([
      { itemId: 'f1', variationId: 'v9', productSlug: 'nrc', productName: 'x', thumbnail: null, flashPrice: 75000, retailPrice: 150000, soldCount: 0, quota: 5, endAt: '2026-10-01T00:00:00.000Z' },
    ]);
    renderGrid();
    expect(await screen.findByText(/Giờ vàng -50%/)).toBeInTheDocument();
    expect(screen.getByText('75.000đ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nước rửa chén' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nrc', { state: { listSource: 'search', variationId: 'v9' } });
  });

  it('skeleton: đúng số thẻ, ẩn với trình đọc màn hình, thân thẻ 133px như thẻ thật', () => {
    render(<CatalogGridSkeleton count={4} />);
    const sk = screen.getByTestId('catalog-grid-skeleton');
    expect(sk).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByTestId('catalog-tile-skeleton')).toHaveLength(4);
    expect(screen.getAllByTestId('catalog-tile-skeleton-body')[0]!.style.height).toBe('133px');
  });
});
