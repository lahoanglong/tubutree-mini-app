import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { homeShortcutSlots } from '@tubutree/app-core/home-layout';
import { ShortcutsSheet } from './shortcuts-sheet';

const all = homeShortcutSlots({ wasteEnabled: true, claimEnabled: true }).all;

describe('ShortcutsSheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('đóng thì không vẽ hộp thoại; mở thì có tên "Tất cả lối tắt" và mỗi mục một dòng', () => {
    const { rerender } = render(<ShortcutsSheet open={false} onClose={vi.fn()} items={all} onSelect={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<ShortcutsSheet open onClose={vi.fn()} items={all} onSelect={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Tất cả lối tắt' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label') !== 'Đóng')).toHaveLength(all.length);
  });

  it('chọn một mục gọi onSelect đúng mục', () => {
    const onSelect = vi.fn();
    render(<ShortcutsSheet open onClose={vi.fn()} items={all} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Đổi quà/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'rewards' }));
  });
});
