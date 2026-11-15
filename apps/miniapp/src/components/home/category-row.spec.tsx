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

/** Tên danh mục thật dài hơn một cột (M3): vẫn tối đa hai dòng, ngắt theo từ, vùng nhãn cao cố định để mọi ô thẳng hàng. */
const LONG_NAMES = ['Chăm sóc nhà cửa thiên nhiên', 'Nông sản & đặc sản', 'Thực phẩm hữu cơ'];
const named = (labels: string[]): CategoryEntry[] => labels.map((label, i) => ({ kind: 'category', key: `n${i}`, label, icon: LayoutGrid, image: null }));
const labelOf = (name: string) => within(screen.getByRole('button', { name })).getByText(name);
const grid = () => screen.getByTestId('category-grid');

describe('CategoryRow — nhãn hai dòng cho tên dài (M3)', () => {
  it('tên dài: nhãn căn giữa, tối đa hai dòng (clamp 2), không một dòng nowrap/ellipsis, cao đúng LABEL_HEIGHT, đủ chữ trong DOM', () => {
    renderRow(0, { entries: named(LONG_NAMES) });
    for (const name of LONG_NAMES) {
      const label = labelOf(name);
      expect(label.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
      expect(label.style.whiteSpace).not.toBe('nowrap');
      expect(label.style.textOverflow).toBe('');
      expect(label).toHaveStyle({ textAlign: 'center', height: `${CATEGORY_LABEL_HEIGHT}px` });
    }
  });

  it('nhãn dùng token nhãn nhỏ 12px/600 (không còn caption 13px, không còn 16px viết tay)', () => {
    renderRow(0, { entries: named(LONG_NAMES) });
    for (const name of LONG_NAMES) {
      const label = labelOf(name);
      expect(label.style.fontSize).toBe('var(--type-label-size)');
      expect(label.style.lineHeight).toBe('var(--type-label-lh)');
    }
  });

  it('hàng một dòng 5 cột 20%: nhãn đúng bề rộng ô, không lấn sang ô kề, không siết chữ', () => {
    renderRow(0, { entries: named(LONG_NAMES) });
    const label = labelOf(LONG_NAMES[0]!);
    expect(label.style.width).toBe('100%');
    expect(label.style.marginLeft).toBe('0px');
    expect(label.style.marginRight).toBe('0px');
    expect(label.style.letterSpacing).toBe('');
  });

  it('nhiều danh mục (Trang chủ chỉ vẽ 4 ô): nhãn vẫn đúng bề rộng ô 20%, không đệm hai bên, không siết chữ (không còn chế độ cột hẹp 5,5)', () => {
    renderRow(0, { entries: named([...LONG_NAMES, ...entries(9).map((e) => e.label)]) });
    const label = labelOf(LONG_NAMES[0]!);
    expect(label.style.letterSpacing).toBe('');
    expect(label.style.width).toBe('100%');
    expect(label.style.paddingLeft).toBe('');
    expect(label.style.paddingRight).toBe('');
    expect(label.style.marginLeft).toBe('0px');
    expect(label.style.marginRight).toBe('0px');
    expect(label).toHaveStyle({ height: `${CATEGORY_LABEL_HEIGHT}px` });
  });

  it('tên một từ dài hơn cột ("Probiotics") và tên một từ ngắn ("Thú cưng"): cùng chiều cao vùng nhãn; từ quá cột mới ngắt giữa từ', () => {
    renderRow(0, { entries: named(['Probiotics', 'Thú cưng']) });
    for (const name of ['Probiotics', 'Thú cưng']) {
      expect(labelOf(name)).toHaveStyle({ height: `${CATEGORY_LABEL_HEIGHT}px`, overflowWrap: 'anywhere' });
    }
  });
});

describe('CategoryRow — một hàng 5 ô: 4 danh mục + "Tất cả"', () => {
  it('vùng tên "Danh mục" với tiêu đề h2; 12 danh mục: lưới 5 cột 20% một hàng, không xếp theo cột, không cuộn ngang (không còn vùng "vuốt ngang")', () => {
    renderRow(12);
    const region = screen.getByRole('region', { name: 'Danh mục' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Danh mục' })).toBeInTheDocument();
    expect(grid()).toHaveStyle({ display: 'grid', gridTemplateColumns: 'repeat(5, 20%)' });
    expect(grid().style.gridAutoFlow).toBe('');
    expect(grid().style.gridTemplateRows).toBe('');
    expect(within(region).queryByRole('region', { name: /vuốt ngang/ })).toBeNull();
    expect(grid().className).not.toContain('scroll-x');
  });

  it('12 danh mục: tiêu đề không có "Xem tất cả Danh mục" (ô "Tất cả" cuối hàng đã làm việc đó); chạm ô "Tất cả" gọi onSeeAll đúng một lần', () => {
    const { onSeeAll } = renderRow(12);
    const header = within(screen.getByRole('region', { name: 'Danh mục' })).getByTestId('section-header');
    expect(within(header).queryByRole('button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả danh mục' }));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('mọi số danh mục (kể cả không có onSeeAll): tiêu đề không có nút "Xem tất cả"', () => {
    for (const [n, over] of [[3, {}], [9, {}], [12, { onSeeAll: undefined }]] as const) {
      const { unmount } = renderRow(n, over);
      const header = within(screen.getByRole('region', { name: 'Danh mục' })).getByTestId('section-header');
      expect(within(header).queryByRole('button')).toBeNull();
      unmount();
    }
  });

  it('mọi số danh mục: xếp theo hàng, 5 cột 1/5 bề rộng, không xếp theo cột', () => {
    for (const n of [2, 3, 4, 6, 9, 12]) {
      const { unmount } = renderRow(n);
      expect(grid()).toHaveStyle({ display: 'grid', gridTemplateColumns: 'repeat(5, 20%)' });
      expect(grid().style.gridAutoFlow).toBe('');
      expect(grid().style.gridTemplateRows).toBe('');
      unmount();
    }
  });

  it('2 danh mục: thứ tự DOM là hai danh mục rồi "Tất cả" ở cuối (cùng hàng, không chen giữa)', () => {
    renderRow(2);
    const buttons = within(grid()).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Danh mục 0', 'Danh mục 1', 'Tất cả danh mục']);
  });

  it('9 hay 10 danh mục: vẫn một hàng 5 ô, không xếp theo cột', () => {
    for (const n of [9, 10]) {
      const { unmount } = renderRow(n);
      expect(grid().style.gridAutoFlow).toBe('');
      expect(within(grid()).getAllByRole('button')).toHaveLength(5);
      unmount();
    }
  });

  it('6 danh mục: chỉ 4 danh mục đầu + "Tất cả" (ô thứ 5); danh mục thứ 5 trở đi không vẽ (có ở tab Danh mục)', () => {
    renderRow(6);
    const buttons = within(grid()).getAllByRole('button');
    expect(buttons).toHaveLength(5);
    expect(buttons.slice(0, 4).map((b) => b.textContent)).toEqual(['Danh mục 0', 'Danh mục 1', 'Danh mục 2', 'Danh mục 3']);
    expect(buttons[4]).toHaveAccessibleName('Tất cả danh mục');
    expect(screen.queryByRole('button', { name: 'Danh mục 4' })).toBeNull();
  });

  it('10 danh mục thật: Trang chủ chỉ vẽ 4 ô + "Tất cả", theo đúng thứ tự `entries`', () => {
    renderRow(10);
    const buttons = within(grid()).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Danh mục 0', 'Danh mục 1', 'Danh mục 2', 'Danh mục 3', 'Tất cả danh mục']);
  });

  it('không có onSeeAll thì không có ô "Tất cả", hàng vẫn tối đa 5 ô', () => {
    renderRow(12, { onSeeAll: undefined });
    expect(screen.queryByRole('button', { name: 'Tất cả danh mục' })).toBeNull();
    expect(within(grid()).getAllByRole('button')).toHaveLength(5);
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

  it('ô không đệm ngang để nhãn dùng đủ cột 20%, nhãn chữ nhỏ tối đa hai dòng, cao đúng LABEL_HEIGHT (H3 #5)', () => {
    renderRow(12);
    const cell = screen.getByRole('button', { name: 'Danh mục 0' });
    expect(cell.style.paddingLeft).toBe('0px');
    expect(cell.style.paddingRight).toBe('0px');
    const label = within(cell).getByText('Danh mục 0');
    expect(label.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    expect(label).toHaveStyle({ height: `${CATEGORY_LABEL_HEIGHT}px` });
  });

  it('nhãn không siết chữ ở mọi số danh mục: cột luôn 20% (không còn cột cuộn 5,5 hẹp ~62px)', () => {
    for (const n of [6, 12]) {
      const { unmount } = renderRow(n);
      expect(within(screen.getByRole('button', { name: 'Danh mục 0' })).getByText('Danh mục 0').style.letterSpacing).toBe('');
      unmount();
    }
  });

  it('đang tải: khung chờ 5 ô mặc định (một hàng); theo số ô nhớ thì ít hơn (cộng ô "Tất cả"), tối đa 5', () => {
    const first = render(<CategoryRow entries={[]} isLoading onSelect={vi.fn()} />);
    expect(screen.getAllByTestId('category-row-skeleton')).toHaveLength(5);
    first.unmount();
    const second = render(<CategoryRow entries={[]} isLoading onSelect={vi.fn()} placeholderCount={2} />);
    expect(screen.getAllByTestId('category-row-skeleton')).toHaveLength(3);
    second.unmount();
    const third = render(<CategoryRow entries={[]} isLoading onSelect={vi.fn()} placeholderCount={4} />);
    expect(screen.getAllByTestId('category-row-skeleton')).toHaveLength(5);
    third.unmount();
    render(<CategoryRow entries={[]} isLoading onSelect={vi.fn()} placeholderCount={20} />);
    expect(screen.getAllByTestId('category-row-skeleton')).toHaveLength(5);
  });

  it('khung chờ và lưới thật dùng cùng một lưới (5 cột 20%, cùng đệm): chiều cao khối bằng nhau nên trang không nhảy khi danh mục về', () => {
    const loading = render(<CategoryRow entries={[]} isLoading onSelect={vi.fn()} />);
    const skeletonStyle = { template: grid().style.gridTemplateColumns, padding: grid().style.padding };
    loading.unmount();
    renderRow(12);
    expect({ template: grid().style.gridTemplateColumns, padding: grid().style.padding }).toEqual(skeletonStyle);
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
