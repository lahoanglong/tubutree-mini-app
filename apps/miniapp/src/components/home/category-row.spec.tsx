import { fireEvent, render, screen, within } from '@testing-library/react';
import { Baby, LayoutGrid } from 'lucide-react';
import { describe, it, expect, vi } from 'vitest';
import type { CategoryEntry } from '../../hooks/use-categories';

vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { CATEGORY_CELL_HEIGHT, CATEGORY_LABEL_HEIGHT } from '@tubutree/app-core/home-layout';
import { CategoryRow } from './category-row';

const entries = (n: number): CategoryEntry[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'category', key: `c${i}`, label: `Danh mục ${i}`, icon: i % 2 ? Baby : LayoutGrid, image: null }));

function renderRow(n: number, over: Partial<React.ComponentProps<typeof CategoryRow>> = {}) {
  const onSelect = vi.fn();
  const onSeeAll = vi.fn();
  const utils = render(<CategoryRow entries={entries(n)} isLoading={false} onSelect={onSelect} onSeeAll={onSeeAll} {...over} />);
  return { onSelect, onSeeAll, ...utils };
}

describe('CategoryRow — lưới 2 hàng × 5 cột (Q7)', () => {
  it('vùng tên "Danh mục" với tiêu đề h2; quá 10 ô: lưới xếp theo cột, 2 hàng, mỗi cột 1/5,5 bề rộng (cột thứ 6 ló nửa cột), cuộn ngang', () => {
    renderRow(12);
    const region = screen.getByRole('region', { name: 'Danh mục' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Danh mục' })).toBeInTheDocument();
    const grid = within(region).getByRole('region', { name: /vuốt ngang/ });
    expect(grid).toHaveStyle({ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(2, auto)' });
    expect(grid.style.gridAutoColumns).toMatch(/^calc\((18\.18\d*%|100% \/ 5\.5)\)$/);
  });

  it('quá 10 ô: tiêu đề có "Xem tất cả Danh mục" (onSeeAll); chạm gọi onSeeAll', () => {
    const { onSeeAll } = renderRow(12);
    const header = within(screen.getByRole('region', { name: 'Danh mục' })).getByTestId('section-header');
    const action = within(header).getByRole('button', { name: 'Xem tất cả Danh mục' });
    fireEvent.click(action);
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('tới 10 ô (lưới vừa một màn) hoặc không có onSeeAll: tiêu đề không có "Xem tất cả" (ô "Tất cả" cuối lưới đã làm việc đó)', () => {
    for (const [n, over] of [[3, {}], [9, {}], [12, { onSeeAll: undefined }]] as const) {
      const { unmount } = renderRow(n, over);
      const header = within(screen.getByRole('region', { name: 'Danh mục' })).getByTestId('section-header');
      expect(within(header).queryByRole('button')).toBeNull();
      unmount();
    }
  });

  it('tới 10 ô (kể cả "Tất cả"): xếp theo hàng, 5 cột 1/5 bề rộng, không xếp theo cột', () => {
    for (const n of [2, 3, 6, 9]) {
      const { unmount } = renderRow(n);
      const grid = screen.getByRole('region', { name: /vuốt ngang/ });
      expect(grid).toHaveStyle({ display: 'grid', gridTemplateColumns: 'repeat(5, 20%)' });
      expect(grid.style.gridAutoFlow).toBe('');
      expect(grid.style.gridTemplateRows).toBe('');
      unmount();
    }
  });

  it('2 danh mục: thứ tự DOM là hai danh mục rồi "Tất cả" ở cuối (cùng hàng, không chen giữa)', () => {
    renderRow(2);
    const buttons = within(screen.getByRole('region', { name: /vuốt ngang/ })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Danh mục 0', 'Danh mục 1', 'Tất cả danh mục']);
  });

  it('9 danh mục + "Tất cả" = 10 ô vẫn xếp theo hàng; 10 danh mục + "Tất cả" = 11 ô chuyển sang cột', () => {
    const nine = renderRow(9);
    expect(screen.getByRole('region', { name: /vuốt ngang/ }).style.gridAutoFlow).toBe('');
    nine.unmount();
    renderRow(10);
    expect(screen.getByRole('region', { name: /vuốt ngang/ }).style.gridAutoFlow).toBe('column');
  });

  it('6 danh mục: 6 ô + "Tất cả" (ô thứ 7), tất cả nằm trong lưới', () => {
    renderRow(6);
    const grid = screen.getByRole('region', { name: /vuốt ngang/ });
    const buttons = within(grid).getAllByRole('button');
    expect(buttons).toHaveLength(7);
    expect(buttons[6]).toHaveAccessibleName('Tất cả danh mục');
  });

  it('12 danh mục: đủ 12 ô + "Tất cả", cuộn ngang theo cột (không cắt bớt)', () => {
    renderRow(12);
    const grid = screen.getByRole('region', { name: /vuốt ngang/ });
    expect(within(grid).getAllByRole('button')).toHaveLength(13);
  });

  it('chạm ô gọi onSelect đúng danh mục; chạm "Tất cả" gọi onSeeAll', () => {
    const { onSelect, onSeeAll } = renderRow(3);
    fireEvent.click(screen.getByRole('button', { name: 'Danh mục 1' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'c1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả danh mục' }));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('không truyền onSeeAll thì không có ô "Tất cả"', () => {
    renderRow(3, { onSeeAll: undefined });
    expect(screen.queryByRole('button', { name: 'Tất cả danh mục' })).toBeNull();
  });

  it('ảnh danh mục có thì vẽ ảnh, không có thì vẽ biểu tượng; ô nền màu xoay vòng', () => {
    const list: CategoryEntry[] = [
      { kind: 'category', key: 'a', label: 'Có ảnh', icon: LayoutGrid, image: 'https://img/a.png' },
      { kind: 'category', key: 'b', label: 'Không ảnh', icon: Baby, image: null },
    ];
    const { container } = render(<CategoryRow entries={list} isLoading={false} onSelect={vi.fn()} />);
    const [withImg, noImg] = screen.getAllByRole('button');
    expect(withImg!.querySelector('img')).toHaveAttribute('src', 'https://img/a.png');
    expect(noImg!.querySelector('svg')).not.toBeNull();
    const tiles = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="category-tile"]'));
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.style.background).not.toBe(tiles[1]!.style.background);
  });

  it('mỗi ô cao tối thiểu 44px', () => {
    renderRow(2);
    for (const b of screen.getAllByRole('button')) expect(b).toHaveStyle({ minHeight: '44px' });
  });

  it('đang tải: khung chờ 10 ô mặc định; theo số ô nhớ thì ít hơn (cộng ô "Tất cả"), tối đa 10', () => {
    const first = render(<CategoryRow entries={[]} isLoading onSelect={vi.fn()} />);
    expect(screen.getAllByTestId('category-row-skeleton')).toHaveLength(10);
    first.unmount();
    const second = render(<CategoryRow entries={[]} isLoading onSelect={vi.fn()} placeholderCount={4} />);
    expect(screen.getAllByTestId('category-row-skeleton')).toHaveLength(5);
    second.unmount();
    render(<CategoryRow entries={[]} isLoading onSelect={vi.fn()} placeholderCount={20} />);
    expect(screen.getAllByTestId('category-row-skeleton')).toHaveLength(10);
  });

  it('ô khung chờ cao đúng ô thật (ô 56 + cách 4 + nhãn 32 = 92): khối phía dưới không nhảy khi danh mục về', () => {
    render(<CategoryRow entries={[]} isLoading onSelect={vi.fn()} placeholderCount={4} />);
    const cell = screen.getAllByTestId('category-row-skeleton')[0]!;
    expect(cell).toHaveStyle({ gap: '4px' });
    const [tile, labelSlot] = Array.from(cell.children) as HTMLElement[];
    expect(tile).toHaveStyle({ height: '56px' });
    expect(labelSlot).toHaveStyle({ height: `${CATEGORY_LABEL_HEIGHT}px` });
    expect(CATEGORY_CELL_HEIGHT).toBe(56 + 4 + CATEGORY_LABEL_HEIGHT);
  });
});
