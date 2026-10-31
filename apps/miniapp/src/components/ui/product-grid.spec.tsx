import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';

vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/shop-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchActiveFlashSales: vi.fn(() => new Promise(() => {})),
  getPublicConfig: vi.fn(() => new Promise(() => {})),
}));

import { ProductGrid } from './product-grid';
import { ProductRail } from './product-rail';

const item = (n: number): ProductCardData => ({
  id: `p${n}`, slug: `sp-${n}`, name: `Sản phẩm ${n}`, brand: 'Tubu', thumbnail: null,
  basePrice: 10_000 * n, salePrice: null, isFeatured: false, inStock: true,
});
const items = [1, 2, 3].map(item);

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  qc.setQueryData(['flash-sales', 'active'], []);
  qc.setQueryData(['public-config'], { catalogLaunchDate: null });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ProductGrid', () => {
  it('là danh sách (ul role=list, li mỗi thẻ), 2 cột, giữ data-testid catalog-grid', () => {
    wrap(<ProductGrid items={items} variant="grid" listSource="browse" />);
    const grid = screen.getByTestId('catalog-grid');
    expect(grid.tagName).toBe('UL');
    expect(grid).toHaveAttribute('role', 'list');
    expect(grid.style.gridTemplateColumns).toBe('1fr 1fr');
    expect(within(grid).getAllByRole('listitem')).toHaveLength(3);
  });

  it('loading vẽ đúng skeletonCount khung chờ và không vẽ thẻ', () => {
    wrap(<ProductGrid items={[]} variant="grid" loading skeletonCount={4} />);
    expect(screen.getByTestId('catalog-grid-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('catalog-tile-skeleton')).toHaveLength(4);
    expect(screen.queryByTestId('catalog-grid')).toBeNull();
  });

  it('rankFrom đánh hạng tăng dần cho biến thể rank', () => {
    wrap(<ProductGrid items={items} variant="rank" rankFrom={4} />);
    expect(screen.getByText('#4')).toBeInTheDocument();
    expect(screen.getByText('#6')).toBeInTheDocument();
  });

  it('onOpen nhận sản phẩm và chỉ số', () => {
    const onOpen = vi.fn();
    wrap(<ProductGrid items={items} variant="grid" onOpen={onOpen} />);
    screen.getByRole('button', { name: 'Sản phẩm 2' }).click();
    expect(onOpen).toHaveBeenCalledWith(items[1], 1);
  });
});

describe('ProductRail', () => {
  const cellsOf = (name: string) => Array.from((screen.getByRole('region', { name }).firstElementChild as HTMLElement).children) as HTMLElement[];

  const cell = (name: string, i = 0) => cellsOf(name)[i] as HTMLElement;

  it('vùng có tên, bề rộng ô theo kích cỡ: rail-md 148, rail-sm 128, rank 128', () => {
    const md = wrap(<ProductRail items={items} variant="rail-md" label="Bán chạy" />);
    expect(cellsOf('Bán chạy')).toHaveLength(3);
    expect(cell('Bán chạy').style.width).toBe('var(--tile-w-md)');
    md.unmount();
    const sm = wrap(<ProductRail items={items} variant="rail-sm" label="Đã xem" />);
    expect(cell('Đã xem').style.width).toBe('var(--tile-w-sm)');
    sm.unmount();
    wrap(<ProductRail items={items} variant="rank" label="Hạng" rankFrom={1} />);
    expect(cell('Hạng').style.width).toBe('var(--tile-w-sm)');
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('đệm kệ chừa bóng và vòng focus, ô kệ giãn đủ chiều cao hàng', () => {
    wrap(<ProductRail items={items} variant="rail-md" label="Bán chạy" />);
    const region = screen.getByRole('region', { name: 'Bán chạy' });
    expect(region.style.padding).toBe('var(--rail-pad-block)');
    const row = region.firstElementChild as HTMLElement;
    expect(row.style.display).toBe('flex');
    expect(row.style.alignItems).toBe('stretch');
    expect(cell('Bán chạy').style.display).toBe('flex');
  });

  it('rail-sm không nhãn đầu tên và không tim dù sản phẩm nổi bật', () => {
    wrap(<ProductRail items={[{ ...item(1), isFeatured: true }]} variant="rail-sm" label="Đã xem" />);
    expect(screen.queryByText('Tubu chọn')).toBeNull();
    expect(screen.queryByRole('button', { name: /Yêu thích/ })).toBeNull();
  });
});
