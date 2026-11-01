import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { ActiveFilters } from './active-filters';

describe('ActiveFilters', () => {
  it('chip "Bỏ lọc X" gọi onPatch với patch của chip; nhóm "Đang lọc" có đệm dọc ≥ 4px', () => {
    const onPatch = vi.fn();
    render(
      <ActiveFilters
        filtersIgnored={false}
        onPatch={onPatch}
        chips={[{ key: 'brand:Tubu', label: 'Tubu', patch: { brands: [] } }, { key: 'inStock', label: 'Còn hàng', patch: { inStock: false } }]}
      />,
    );
    const group = screen.getByRole('group', { name: 'Đang lọc' });
    expect(parseFloat(group.style.paddingTop)).toBeGreaterThanOrEqual(4);
    expect(parseFloat(group.style.paddingBottom)).toBeGreaterThanOrEqual(4);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Tubu' }));
    expect(onPatch).toHaveBeenCalledWith({ brands: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Còn hàng' }));
    expect(onPatch).toHaveBeenLastCalledWith({ inStock: false });
  });

  it('không chip và không cờ: không vẽ gì (không để lại khoảng trống)', () => {
    const { container } = render(<ActiveFilters chips={[]} filtersIgnored={false} onPatch={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('API cũ bỏ qua bộ lọc: câu báo nhẹ, không cần chip', () => {
    render(<ActiveFilters chips={[]} filtersIgnored onPatch={vi.fn()} />);
    expect(screen.getByText(/Bộ lọc nâng cao chưa dùng được/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Đang lọc' })).toBeNull();
  });
});
