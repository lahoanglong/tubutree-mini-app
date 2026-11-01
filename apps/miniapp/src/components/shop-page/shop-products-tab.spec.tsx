import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';

const mocks = vi.hoisted(() => ({ fetchBrandProducts: vi.fn() }));

vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/brand-api', () => ({ fetchBrandProducts: mocks.fetchBrandProducts }));
vi.mock('../../services/shop-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchActiveFlashSales: vi.fn(() => new Promise(() => {})),
  getPublicConfig: vi.fn(() => new Promise(() => {})),
}));

import { ShopProductsTab } from './shop-products-tab';

const product = (n: number, over: Partial<ProductCardData> = {}): ProductCardData => ({
  id: `p${n}`, slug: `sp-${n}`, name: `Sản phẩm ${String(n).padStart(2, '0')}`, brand: 'Tubu', thumbnail: null,
  basePrice: 10_000 * n, salePrice: null, isFeatured: false, inStock: true, sold: n, createdAt: `2026-10-${String((n % 28) + 1).padStart(2, '0')}T00:00:00Z`, ...over,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => product(i + 1));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['flash-sales', 'active'], []);
  qc.setQueryData(['public-config'], { catalogLaunchDate: null });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const names = () =>
  screen
    .getAllByRole('button', { name: /Sản phẩm \d{2}$/ })
    .flatMap((b) => /Sản phẩm \d{2}/.exec(b.textContent ?? '')?.slice(0, 1) ?? []);
const tileCount = () => document.querySelectorAll('[data-ds="product-tile"]').length;
const more = () => screen.queryByRole('button', { name: 'Xem thêm' });

beforeEach(() => mocks.fetchBrandProducts.mockReset());

describe('ShopProductsTab nguồn local (gian hàng CTV)', () => {
  it('45 sản phẩm: trang 1 có 20 thẻ, "Xem thêm" lên 40 rồi 45 và hết nút', () => {
    wrap(<ShopProductsTab source={{ kind: 'local', products: many(45) }} />);
    expect(tileCount()).toBe(20);
    fireEvent.click(more()!);
    expect(tileCount()).toBe(40);
    fireEvent.click(more()!);
    expect(tileCount()).toBe(45);
    expect(more()).toBeNull();
  });

  it('sản phẩm trùng giữa hai bộ chỉ một thẻ', () => {
    wrap(<ShopProductsTab source={{ kind: 'local', products: [product(1), product(2), product(1)] }} />);
    expect(tileCount()).toBe(2);
  });

  it('SortBar: "Giá" tăng dần rồi đảo chiều; "Mới" theo ngày tạo; "Bán chạy" theo đã bán; "Phổ biến" về thứ tự gốc', () => {
    const list = [
      product(1, { basePrice: 10_000, sold: 1, createdAt: '2026-10-20T00:00:00Z' }),
      product(2, { basePrice: 20_000, sold: 9, createdAt: '2026-10-10T00:00:00Z' }),
      product(3, { basePrice: 30_000, sold: 5, createdAt: '2026-10-15T00:00:00Z' }),
    ];
    wrap(<ShopProductsTab source={{ kind: 'local', products: list }} />);
    const price = screen.getByRole('button', { name: 'Giá, đổi chiều sắp xếp' });
    fireEvent.click(price);
    expect(names()).toEqual(['Sản phẩm 01', 'Sản phẩm 02', 'Sản phẩm 03']);
    fireEvent.click(price);
    expect(names()).toEqual(['Sản phẩm 03', 'Sản phẩm 02', 'Sản phẩm 01']);
    fireEvent.click(screen.getByRole('button', { name: 'Mới' }));
    expect(names()).toEqual(['Sản phẩm 01', 'Sản phẩm 03', 'Sản phẩm 02']);
    fireEvent.click(screen.getByRole('button', { name: 'Bán chạy' }));
    expect(names()).toEqual(['Sản phẩm 02', 'Sản phẩm 03', 'Sản phẩm 01']);
    fireEvent.click(screen.getByRole('button', { name: 'Phổ biến' }));
    expect(names()).toEqual(['Sản phẩm 01', 'Sản phẩm 02', 'Sản phẩm 03']);
  });

  it('đổi cách sắp xếp thì quay về trang đầu (20 thẻ)', () => {
    wrap(<ShopProductsTab source={{ kind: 'local', products: many(45) }} />);
    fireEvent.click(more()!);
    expect(tileCount()).toBe(40);
    fireEvent.click(screen.getByRole('button', { name: 'Bán chạy' }));
    expect(tileCount()).toBe(20);
  });

  it('rỗng: thông báo, không SortBar', () => {
    wrap(<ShopProductsTab source={{ kind: 'local', products: [] }} />);
    expect(screen.getByText('Shop chưa có sản phẩm nào để hiện')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Phổ biến' })).toBeNull();
  });

  it('scope: hiện chip tên bộ, bấm gỡ gọi onClear', () => {
    const onClear = vi.fn();
    wrap(<ShopProductsTab source={{ kind: 'local', products: many(3) }} scope={{ label: 'Bếp xanh', onClear }} />);
    fireEvent.click(screen.getByRole('button', { name: /Bếp xanh/ }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('showBrand=false bỏ dòng thương hiệu trên thẻ', () => {
    wrap(<ShopProductsTab source={{ kind: 'local', products: many(2) }} showBrand={false} />);
    expect(document.querySelector('[data-ds-part="brand"]')).toBeNull();
  });
});

describe('ShopProductsTab nguồn brand (phân trang thật)', () => {
  const page = (from: number, count: number, total: number) => ({
    data: Array.from({ length: count }, (_, i) => product(from + i)),
    meta: { page: 1, limit: 20, total },
  });

  it('trang 1 rồi "Xem thêm" gọi trang 2, 3 tới hết meta.total, truyền sort đúng', async () => {
    mocks.fetchBrandProducts
      .mockResolvedValueOnce(page(1, 20, 45))
      .mockResolvedValueOnce(page(21, 20, 45))
      .mockResolvedValueOnce(page(41, 5, 45));
    wrap(<ShopProductsTab source={{ kind: 'brand', slug: 'fuwa' }} showBrand={false} />);
    await waitFor(() => expect(tileCount()).toBe(20));
    expect(mocks.fetchBrandProducts).toHaveBeenNthCalledWith(1, 'fuwa', { page: 1, limit: 20, sort: undefined });
    fireEvent.click(more()!);
    await waitFor(() => expect(tileCount()).toBe(40));
    expect(mocks.fetchBrandProducts).toHaveBeenNthCalledWith(2, 'fuwa', { page: 2, limit: 20, sort: undefined });
    fireEvent.click(more()!);
    await waitFor(() => expect(tileCount()).toBe(45));
    expect(more()).toBeNull();
  });

  it('đổi sang "Mới" tải lại từ trang 1 với sort=newest', async () => {
    mocks.fetchBrandProducts.mockResolvedValue(page(1, 3, 3));
    wrap(<ShopProductsTab source={{ kind: 'brand', slug: 'fuwa' }} />);
    await waitFor(() => expect(tileCount()).toBe(3));
    fireEvent.click(screen.getByRole('button', { name: 'Mới' }));
    await waitFor(() => expect(mocks.fetchBrandProducts).toHaveBeenLastCalledWith('fuwa', { page: 1, limit: 20, sort: 'newest' }));
  });

  it('nhãn chưa có sản phẩm: thông báo rỗng; lỗi API: có "Thử lại" gọi lại', async () => {
    mocks.fetchBrandProducts.mockResolvedValueOnce({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    const a = wrap(<ShopProductsTab source={{ kind: 'brand', slug: 'fuwa' }} />);
    expect(await screen.findByText('Shop chưa có sản phẩm nào để hiện')).toBeInTheDocument();
    a.unmount();
    mocks.fetchBrandProducts.mockReset();
    mocks.fetchBrandProducts.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(page(1, 2, 2));
    wrap(<ShopProductsTab source={{ kind: 'brand', slug: 'fuwa' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(tileCount()).toBe(2));
  });
});
