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
  it('chế độ cuộn: tab không co lại dưới độ rộng chữ (nhãn không chồng nhau ở 390px)', () => {
    render(<SegmentedTabs items={items} value="all" onChange={() => {}} scroll />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.style.flex).toBe('0 0 auto');
    }
  });
  it('chế độ chia đều: tab giãn đều và vẫn co được', () => {
    render(<SegmentedTabs items={items} value="all" onChange={() => {}} />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.style.flexGrow).toBe('1');
    }
  });
  it('chế độ cuộn: cuộn tab đang chọn vào tầm nhìn khi đổi tab', () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      const { rerender } = render(<SegmentedTabs items={items} value="all" onChange={() => {}} scroll />);
      scrollIntoView.mockClear();
      rerender(<SegmentedTabs items={items} value="pending" onChange={() => {}} scroll />);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('tab', { name: /Chờ xử lý/ }));
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
