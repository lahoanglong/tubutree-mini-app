import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayoutGrid } from 'lucide-react';
import type * as ZmpUi from 'zmp-ui';

vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import type { CategoryEntry } from '../../hooks/use-categories';
import { CategoryTiles } from './category-tiles';

const entry = (i: number, image: string | null = null): CategoryEntry => ({ kind: 'category', key: `c${i}`, label: `Danh mục ${i}`, icon: LayoutGrid, image });
const many = (n: number) => Array.from({ length: n }, (_, i) => entry(i + 1));

describe('CategoryTiles', () => {
  it('vùng "Danh mục" có tiêu đề h2; 10 danh mục chỉ hiện 8 ô + ô "Tất cả" ở cuối', () => {
    render(<CategoryTiles entries={many(10)} isLoading={false} placeholderCount={4} onSelect={vi.fn()} onSelectAll={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'Danh mục' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Danh mục' })).toBeInTheDocument();
    const names = within(region).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([...many(8).map((e) => e.label), 'Tất cả']);
  });

  it('chạm ô gọi onSelect(mục); "Tất cả" gọi onSelectAll', () => {
    const onSelect = vi.fn();
    const onSelectAll = vi.fn();
    const entries = many(3);
    render(<CategoryTiles entries={entries} isLoading={false} placeholderCount={4} onSelect={onSelect} onSelectAll={onSelectAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Danh mục 2' }));
    expect(onSelect).toHaveBeenCalledWith(entries[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('danh sách rỗng vẫn có ô "Tất cả" (hub không bao giờ cụt)', () => {
    render(<CategoryTiles entries={[]} isLoading={false} placeholderCount={4} onSelect={vi.fn()} onSelectAll={vi.fn()} />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Tất cả']);
  });

  it('đang tải: placeholderCount + 1 khung chờ ẩn khỏi trình đọc, không có nút', () => {
    render(<CategoryTiles entries={many(3)} isLoading placeholderCount={6} onSelect={vi.fn()} onSelectAll={vi.fn()} />);
    const loading = screen.getByTestId('category-grid-loading');
    expect(loading).toHaveAttribute('aria-hidden', 'true');
    expect(loading.children).toHaveLength(7);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('ô cao tối thiểu 88px (vùng chạm), ảnh danh mục thay icon và chỉ để trang trí', () => {
    const entries = [entry(1, 'https://img.test/a.jpg'), entry(2)];
    const { container } = render(<CategoryTiles entries={entries} isLoading={false} placeholderCount={4} onSelect={vi.fn()} onSelectAll={vi.fn()} />);
    for (const b of screen.getAllByRole('button')) expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(88);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://img.test/a.jpg');
    expect(img).toHaveAttribute('alt', '');
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('nhãn tối đa hai dòng (cắt bằng line-clamp), không tràn ô', () => {
    render(<CategoryTiles entries={[{ ...entry(1), label: 'Chăm sóc cá nhân và làm đẹp tự nhiên' }]} isLoading={false} placeholderCount={4} onSelect={vi.fn()} onSelectAll={vi.fn()} />);
    const label = screen.getByRole('button', { name: 'Chăm sóc cá nhân và làm đẹp tự nhiên' }).querySelector('[data-tile-label]') as HTMLElement;
    expect(label.style.webkitLineClamp).toBe('2');
    expect(label.style.overflow).toBe('hidden');
  });
});
