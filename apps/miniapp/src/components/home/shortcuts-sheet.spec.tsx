import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { homeShortcutGrid } from '@tubutree/app-core/home-layout';
import { ShortcutsSheet } from './shortcuts-sheet';

const all = homeShortcutGrid().more;

describe('ShortcutsSheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('đóng thì không vẽ hộp thoại; mở thì có tên "Thêm lối tắt" và mỗi lối tắt chưa lên lưới một dòng', () => {
    const { rerender } = render(<ShortcutsSheet open={false} onClose={vi.fn()} items={all} onSelect={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<ShortcutsSheet open onClose={vi.fn()} items={all} onSelect={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Thêm lối tắt' })).toBeInTheDocument();
    expect(all.map((s) => s.id)).toEqual(['community', 'gifts', 'earn']);
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label') !== 'Đóng')).toHaveLength(all.length);
  });

  it('chọn một mục gọi onSelect đúng mục', () => {
    const onSelect = vi.fn();
    render(<ShortcutsSheet open onClose={vi.fn()} items={all} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Bộ quà tặng/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'gifts' }));
  });
});
