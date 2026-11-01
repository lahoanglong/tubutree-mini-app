import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LayoutGrid } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), coreGet: vi.fn(), fetchCatalog: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../../services/shop-api', () => ({
  getPublicConfig: vi.fn().mockResolvedValue({}),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  fetchProductsBySlugs: vi.fn().mockResolvedValue([]),
  fetchCatalog: mocks.fetchCatalog,
}));

import { SEGMENT_ENTRIES, type CategoryEntry } from '../../hooks/use-categories';
import { BrowseHub, type BrowseHubProps } from './browse-hub';

const P = (i: number) => ({ id: `p${i}`, slug: `p${i}`, brand: 'Tubu', name: `Bán chạy ${i}`, thumbnail: null, basePrice: 45000, salePrice: null, isFeatured: false, inStock: true });
const page = (n: number) => ({ data: Array.from({ length: n }, (_, i) => P(i + 1)), meta: { page: 1, limit: 10, total: n } });
const flat = (n: number): CategoryEntry[] => Array.from({ length: n }, (_, i) => ({ kind: 'category', key: `c${i}`, label: `Mục ${i + 1}`, icon: LayoutGrid, image: null }));

const handlers = { onPickCategory: vi.fn(), onPickAll: vi.fn(), onPickBrand: vi.fn() };
const BRANDS = [{ brand: 'Tubu', count: 9 }, { brand: 'Cỏ Mềm', count: 5 }, { brand: 'Xanh', count: 3 }, { brand: 'Lá', count: 2 }];

function renderHub(over: Partial<BrowseHubProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BrowseHub entries={SEGMENT_ENTRIES} categoriesLoading={false} placeholderCount={4} brands={BRANDS} {...handlers} {...over} />
    </QueryClientProvider>,
  );
}

describe('BrowseHub', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.coreGet.mockResolvedValue(page(10));
    mocks.fetchCatalog.mockRejectedValue(new Error('hub không được tải danh sách'));
  });

  it('API best-sellers trả 10: kệ có tiêu đề "Bán chạy nhất" và 10 thẻ hạng 1..10', async () => {
    renderHub();
    const region = await screen.findByRole('region', { name: 'Bán chạy nhất' });
    await waitFor(() => expect(region.querySelectorAll('button').length).toBeGreaterThanOrEqual(10));
    const ranks = Array.from(region.querySelectorAll('[data-ds-part="rank"]')).map((n) => n.textContent);
    expect(ranks).toEqual(Array.from({ length: 10 }, (_, i) => `#${i + 1}`));
    expect(mocks.coreGet).toHaveBeenCalledWith('/products', { query: { sort: 'best_seller_30d', limit: 10 } });
  });

  it('API trả 2 món: kệ ẩn hẳn, nút "Xem tất cả sản phẩm" vẫn còn', async () => {
    mocks.coreGet.mockResolvedValue(page(2));
    renderHub();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bán chạy nhất' })).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Bán chạy nhất' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Xem tất cả sản phẩm' })).toBeInTheDocument();
  });

  it('API lỗi: kệ ẩn, phần còn lại của hub không đổ', async () => {
    mocks.coreGet.mockRejectedValue(Object.assign(new Error('500'), { status: 500 }));
    renderHub();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Bán chạy nhất' })).toBeNull());
    expect(screen.getByRole('region', { name: 'Danh mục' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xem tất cả sản phẩm' })).toBeInTheDocument();
  });

  it('hub KHÔNG gọi fetchCatalog (không tải danh sách khi chưa cần)', async () => {
    renderHub();
    await screen.findByRole('region', { name: 'Bán chạy nhất' });
    expect(mocks.fetchCatalog).not.toHaveBeenCalled();
  });

  it('cây danh mục rỗng: entries là 4 phân khúc dự phòng vẫn vẽ 4 ô + "Tất cả"', async () => {
    renderHub({ entries: SEGMENT_ENTRIES });
    const region = screen.getByRole('region', { name: 'Danh mục' });
    expect(within(region).getAllByRole('button')).toHaveLength(5);
    fireEvent.click(within(region).getByRole('button', { name: SEGMENT_ENTRIES[0]!.label }));
    expect(handlers.onPickCategory).toHaveBeenCalledWith(SEGMENT_ENTRIES[0]);
    await screen.findByRole('region', { name: 'Bán chạy nhất' });
  });

  it('danh mục gốc phẳng 7 mục: 7 ô + "Tất cả"', async () => {
    renderHub({ entries: flat(7) });
    expect(within(screen.getByRole('region', { name: 'Danh mục' })).getAllByRole('button')).toHaveLength(8);
    await screen.findByRole('region', { name: 'Bán chạy nhất' });
  });

  it('thứ tự: Danh mục, Đã xem (nếu có), Bán chạy nhất, Thương hiệu, nút Xem tất cả', async () => {
    localStorage.setItem('tubu_recently_viewed', JSON.stringify([{ slug: 'a', name: 'Sản phẩm A', thumbnail: null, price: 1, viewedAt: 1 }]));
    const { container } = renderHub();
    await screen.findByRole('region', { name: 'Bán chạy nhất' });
    const headings = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
    expect(headings).toEqual(['Danh mục', 'Đã xem gần đây', 'Bán chạy nhất', 'Thương hiệu']);
    const all = screen.getByRole('button', { name: 'Xem tất cả sản phẩm' });
    expect(container.lastElementChild).toContainElement(all);
  });

  it('chạm "Xem tất cả" của kệ → điều hướng (PUSH) tới danh sách xếp bán chạy; nút lớn → onPickAll; ô thương hiệu → onPickBrand', async () => {
    renderHub();
    await screen.findByRole('region', { name: 'Bán chạy nhất' });
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả Bán chạy nhất' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse?sort=best_seller');
    expect(handlers.onPickAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả sản phẩm' }));
    expect(handlers.onPickAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Xem thương hiệu Cỏ Mềm' }));
    expect(handlers.onPickBrand).toHaveBeenCalledWith('Cỏ Mềm');
  });

  it('không có chữ "Top", "Voucher", "cửa hàng" trên hub', async () => {
    const { container } = renderHub();
    await screen.findByRole('region', { name: 'Bán chạy nhất' });
    expect(container.textContent).not.toMatch(/\bTop\b|Voucher|cửa hàng/);
  });
});
