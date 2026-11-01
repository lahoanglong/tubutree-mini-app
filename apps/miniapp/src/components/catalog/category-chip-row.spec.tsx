import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import type { CategoryNode } from '@tubutree/app-core/browse/category-tree';
import { CategoryChipRow } from './category-chip-row';

const node = (id: string, name: string): CategoryNode => ({ id, parentId: null, name, slug: id, image: null, productCount: 2, children: [] });
const PARENT = node('da', 'Chăm sóc da');
const CHIPS = [node('rua-mat', 'Rửa mặt'), node('chong-nang', 'Chống nắng')];

describe('CategoryChipRow', () => {
  it('nhóm "Danh mục con": chip Tất cả + một chip mỗi danh mục con; Tất cả chọn khi đang ở cha', () => {
    render(<CategoryChipRow parent={PARENT} chips={CHIPS} activeId="da" onSelect={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Danh mục con' });
    expect(group.querySelectorAll('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Rửa mặt' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('đang ở một con: chip đó được chọn, chạm Tất cả quay về cha, chạm anh em chuyển sang anh em', () => {
    const onSelect = vi.fn();
    render(<CategoryChipRow parent={PARENT} chips={CHIPS} activeId="chong-nang" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Chống nắng' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
    expect(onSelect).toHaveBeenLastCalledWith('da');
    fireEvent.click(screen.getByRole('button', { name: 'Rửa mặt' }));
    expect(onSelect).toHaveBeenLastCalledWith('rua-mat');
  });

  it('chạm chip đang chọn không gọi onSelect', () => {
    const onSelect = vi.fn();
    render(<CategoryChipRow parent={PARENT} chips={CHIPS} activeId="rua-mat" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rửa mặt' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('hàng cuộn ngang có đệm dọc ≥ 4px để vùng chạm 44px của Chip không bị cắt', () => {
    render(<CategoryChipRow parent={PARENT} chips={CHIPS} activeId="da" onSelect={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Danh mục con' });
    expect(group).toHaveClass('scroll-x');
    expect(parseFloat(group.style.paddingTop)).toBeGreaterThanOrEqual(4);
    expect(parseFloat(group.style.paddingBottom)).toBeGreaterThanOrEqual(4);
  });
});
