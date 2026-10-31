import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Baby, LayoutGrid } from 'lucide-react';

vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { SEGMENT_ENTRIES } from '../../hooks/use-categories';
import { CategoryGrid } from './category-grid';

const ENTRIES = [
  { kind: 'category' as const, key: 'cat-a', label: 'Tẩy rửa sinh học', icon: LayoutGrid },
  { kind: 'segment' as const, key: 'mom_baby', label: 'Cho mẹ & bé', icon: Baby },
];

describe('CategoryGrid', () => {
  it('vùng "Danh mục" với 1 nút cho mỗi mục; chạm → onSelect(mục)', () => {
    const onSelect = vi.fn();
    render(<CategoryGrid entries={ENTRIES} isLoading={false} onSelect={onSelect} />);
    const region = screen.getByRole('region', { name: 'Danh mục' });
    fireEvent.click(screen.getByRole('button', { name: 'Cho mẹ & bé' }));
    expect(onSelect).toHaveBeenCalledWith(ENTRIES[1]);
    expect(region.querySelectorAll('button')).toHaveLength(2);
  });

  it('mỗi mục là <button> thật: Tab tới được và Enter / Space chọn', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CategoryGrid entries={ENTRIES} isLoading={false} onSelect={onSelect} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Tẩy rửa sinh học' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(ENTRIES[0]);
    await user.tab();
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenLastCalledWith(ENTRIES[1]);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('tiêu đề tuỳ biến đặt tên cho vùng', () => {
    render(<CategoryGrid entries={ENTRIES} isLoading={false} onSelect={vi.fn()} title="Mua theo nhu cầu" />);
    expect(screen.getByRole('region', { name: 'Mua theo nhu cầu' })).toBeInTheDocument();
  });

  it('đang tải → khung chờ aria-hidden, chưa có nút; số ô chờ = số phân khúc dự phòng (4)', () => {
    render(<CategoryGrid entries={ENTRIES} isLoading onSelect={vi.fn()} />);
    const loading = screen.getByTestId('category-grid-loading');
    expect(loading).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button')).toBeNull();
    expect(SEGMENT_ENTRIES).toHaveLength(4);
    expect(loading.children).toHaveLength(SEGMENT_ENTRIES.length);
  });

  it('placeholderCount tuỳ biến đổi số ô chờ, và ô chờ cao bằng ô thật (44px)', () => {
    const { rerender } = render(<CategoryGrid entries={ENTRIES} isLoading placeholderCount={6} onSelect={vi.fn()} />);
    const loading = screen.getByTestId('category-grid-loading');
    expect(loading.children).toHaveLength(6);
    expect(((loading.children[0] as HTMLElement).firstElementChild as HTMLElement).style.height).toBe('44px');
    rerender(<CategoryGrid entries={ENTRIES} isLoading={false} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cho mẹ & bé' }).style.minHeight).toBe('44px');
  });
});
