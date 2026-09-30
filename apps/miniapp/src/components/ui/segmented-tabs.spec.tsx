import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SegmentedTabs } from './segmented-tabs';

describe('SegmentedTabs', () => {
  const items = [{ key: 'all', label: 'Tất cả' }, { key: 'pending', label: 'Chờ xử lý', count: 3 }];
  it('renders all items, marks the active one', () => {
    render(<SegmentedTabs items={items} value="all" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /Tất cả/, selected: true })).toBeInTheDocument();
  });
  it('calls onChange with the clicked key', () => {
    const onChange = vi.fn();
    render(<SegmentedTabs items={items} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByText(/Chờ xử lý/));
    expect(onChange).toHaveBeenCalledWith('pending');
  });
  it('shows count badge when provided', () => {
    render(<SegmentedTabs items={items} value="all" onChange={() => {}} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
  it('mỗi tab cao ≥44px (vùng chạm tối thiểu)', () => {
    render(<SegmentedTabs items={[{ key: 'a', label: 'A' }]} value="a" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'A' })).toHaveStyle({ minHeight: '44px' });
  });
});
