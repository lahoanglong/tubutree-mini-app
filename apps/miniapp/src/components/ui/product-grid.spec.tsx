import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';

vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../../services/shop-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchActiveFlashSales: vi.fn(() => new Promise(() => {})),
  getPublicConfig: vi.fn(() => new Promise(() => {})),
}));

import { tileBodyHeight } from '@tubutree/app-core/commerce/tile-metrics';
import { ProductGrid } from './product-grid';
import { ProductRail } from './product-rail';
import { trackEvent } from '../../services/analytics';

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

  it('loading + reserve: lưới 2 cột như thẻ thật, mỗi ô một nút ảnh 1:1 + thân tileBodyHeight (không vạch chờ bên trong)', () => {
    wrap(<ProductGrid items={[]} variant="grid" loading reserve skeletonCount={3} />);
    const grid = screen.getByTestId('catalog-grid-reserve');
    expect(grid.getAttribute('aria-hidden')).toBe('true');
    expect(grid.style.gridTemplateColumns).toBe('1fr 1fr');
    const cells = Array.from(grid.children) as HTMLElement[];
    expect(cells).toHaveLength(3);
    expect(cells.every((el) => el.childElementCount === 0)).toBe(true);
    expect(cells[0]!.style.aspectRatio).toBe('1 / 1');
    expect(cells[0]!.style.paddingBottom).toBe(`${tileBodyHeight('grid')}px`);
    expect(screen.queryByTestId('catalog-grid-skeleton')).toBeNull();
    expect(screen.queryAllByTestId('catalog-tile-skeleton')).toHaveLength(0);
  });

  it('rankFrom đánh hạng tăng dần cho biến thể rank', () => {
    wrap(<ProductGrid items={items} variant="rank" rankFrom={4} />);
    expect(screen.getByText('#4')).toBeInTheDocument();
    expect(screen.getByText('#6')).toBeInTheDocument();
  });

  it('noteOf đưa ghi chú vào trong thẻ; thẻ không ghi chú giữ chỗ dòng đó để cùng hàng thẳng giá', () => {
    wrap(<ProductGrid items={items} variant="grid" noteOf={(p, i) => (i === 1 ? `Dùng hằng ngày (${p.id})` : undefined)} />);
    const notes = Array.from(document.querySelectorAll('[data-ds-part="note"]'));
    expect(notes.map((n) => n.textContent)).toEqual(['', 'Dùng hằng ngày (p2)', '']);
  });

  it('columns=1 xếp một cột (hàng dòng của khối STACK)', () => {
    wrap(<ProductGrid items={items} variant="line" columns={1} />);
    expect(screen.getByTestId('catalog-grid').style.gridTemplateColumns).toBe('1fr');
  });

  it('không ai có ghi chú thì không vẽ dòng ghi chú nào', () => {
    wrap(<ProductGrid items={items} variant="grid" noteOf={() => undefined} />);
    expect(document.querySelectorAll('[data-ds-part="note"]')).toHaveLength(0);
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

  it('noteOf đưa ghi chú vào thẻ của kệ', () => {
    wrap(<ProductRail items={items} variant="rail-md" label="Nổi bật" noteOf={(_, i) => (i === 0 ? 'Mình dùng mỗi ngày' : undefined)} />);
    expect(Array.from(document.querySelectorAll('[data-ds-part="note"]')).map((n) => n.textContent)).toEqual(['Mình dùng mỗi ngày', '', '']);
  });

  it('rail-sm không nhãn đầu tên và không tim dù sản phẩm nổi bật', () => {
    wrap(<ProductRail items={[{ ...item(1), isFeatured: true }]} variant="rail-sm" label="Đã xem" />);
    expect(screen.queryByText('Tubu chọn')).toBeNull();
    expect(screen.queryByRole('button', { name: /Yêu thích/ })).toBeNull();
  });
});

describe('product_card_click theo vị trí trong lưới/kệ', () => {
  it.each([
    ['ProductGrid', (on: string) => <ProductGrid items={items} variant="grid" listSource={on} />],
    ['ProductRail', (on: string) => <ProductRail items={items} variant="rail-md" label="Kệ" listSource={on} />],
  ])('%s: vị trí 1-based theo thứ tự thẻ', (_name, ui) => {
    vi.mocked(trackEvent).mockClear();
    wrap(ui('browse'));
    fireEvent.click(screen.getByRole('button', { name: 'Sản phẩm 2' }));
    expect(trackEvent).toHaveBeenCalledWith('product_card_click', 'miniapp', { shelf: 'browse', position: 2, productSlug: 'sp-2' });
  });
});
