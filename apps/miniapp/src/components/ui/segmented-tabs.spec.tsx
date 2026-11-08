import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SegmentedTabs } from './segmented-tabs';

describe('SegmentedTabs', () => {
  const items = [{ key: 'all', label: 'Tất cả' }, { key: 'pending', label: 'Chờ xử lý', count: 3 }];
  it('renders all items, marks the active one', () => {
    render(<SegmentedTabs items={items} value="all" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /Tất cả/, selected: true })).toBeInTheDocument();
  });
  it('`label` đặt tên cho dải tab (trình đọc màn hình đọc được "Danh mục bán chạy"); thiếu thì không có tên', () => {
    const { rerender } = render(<SegmentedTabs items={items} value="all" onChange={() => {}} label="Danh mục bán chạy" />);
    expect(screen.getByRole('tablist', { name: 'Danh mục bán chạy' })).toBeInTheDocument();
    rerender(<SegmentedTabs items={items} value="all" onChange={() => {}} />);
    expect(screen.getByRole('tablist')).not.toHaveAttribute('aria-label');
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

describe('SegmentedTabs: roving tabindex + phím mũi tên/Home/End (mẫu tabs của APG)', () => {
  const three = [
    { key: 'a', label: 'A' },
    { key: 'b', label: 'B' },
    { key: 'c', label: 'C' },
  ];
  const tabs = () => screen.getAllByRole('tab');
  const tabOf = (label: string) => tabs().find((t) => t.textContent === label)!;
  const tabIndexes = () => tabs().map((t) => t.getAttribute('tabindex'));

  function Stateful({ initial }: { initial: string }) {
    const [value, setValue] = useState(initial);
    return <SegmentedTabs items={three} value={value} onChange={setValue} />;
  }

  it('chỉ tab đang chọn nằm trong thứ tự Tab, tab khác tabindex -1; đổi chọn thì điểm dừng đi theo', () => {
    const { rerender } = render(<SegmentedTabs items={three} value="b" onChange={() => {}} />);
    expect(tabIndexes()).toEqual(['-1', '0', '-1']);
    rerender(<SegmentedTabs items={three} value="c" onChange={() => {}} />);
    expect(tabIndexes()).toEqual(['-1', '-1', '0']);
  });

  it('value không khớp tab nào: tab đầu giữ điểm dừng Tab, không tab nào aria-selected', () => {
    render(<SegmentedTabs items={three} value="zzz" onChange={() => {}} />);
    expect(tabIndexes()).toEqual(['0', '-1', '-1']);
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false']);
  });

  it('không có tab nào: dải rỗng, không lỗi', () => {
    render(<SegmentedTabs items={[]} value="a" onChange={() => {}} />);
    expect(screen.getByRole('tablist')).toBeEmptyDOMElement();
  });

  it.each([
    ['ArrowRight', 'a', 'B'],
    ['ArrowRight', 'b', 'C'],
    ['ArrowRight', 'c', 'A'],
    ['ArrowLeft', 'c', 'B'],
    ['ArrowLeft', 'b', 'A'],
    ['ArrowLeft', 'a', 'C'],
    ['Home', 'c', 'A'],
    ['Home', 'a', 'A'],
    ['End', 'a', 'C'],
    ['End', 'c', 'C'],
  ])('%s ở tab %s: chọn tab %s và chuyển tiêu điểm sang đó', (key, from, to) => {
    const onChange = vi.fn();
    render(<SegmentedTabs items={three} value={from} onChange={onChange} />);
    const source = tabOf(from.toUpperCase());
    source.focus();
    const notPrevented = fireEvent.keyDown(source, { key });
    expect(notPrevented).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(to.toLowerCase());
    expect(tabOf(to)).toHaveFocus();
  });

  it('phím tính theo tab đang bấm phím, không theo tab đang chọn', () => {
    const onChange = vi.fn();
    render(<SegmentedTabs items={three} value="a" onChange={onChange} />);
    const source = tabOf('B');
    source.focus();
    fireEvent.keyDown(source, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('c');
    expect(tabOf('C')).toHaveFocus();
  });

  it.each(['Enter', ' ', 'ArrowUp', 'ArrowDown', 'Tab', 'a'])('phím %j không đổi tab và không bị chặn mặc định', (key) => {
    const onChange = vi.fn();
    render(<SegmentedTabs items={three} value="a" onChange={onChange} />);
    const source = tabOf('A');
    source.focus();
    expect(fireEvent.keyDown(source, { key })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(source).toHaveFocus();
  });

  it.each(['altKey', 'ctrlKey', 'metaKey'])('giữ %s thì mũi tên thuộc về trình duyệt (vd Alt+← là Back): không đổi tab, không chặn mặc định', (modifier) => {
    const onChange = vi.fn();
    render(<SegmentedTabs items={three} value="a" onChange={onChange} />);
    const source = tabOf('A');
    source.focus();
    expect(fireEvent.keyDown(source, { key: 'ArrowRight', [modifier]: true })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('luồng đủ: mũi tên đổi tab, tiêu điểm đi theo, điểm dừng Tab đi theo tab mới', () => {
    render(<Stateful initial="a" />);
    tabOf('A').focus();
    fireEvent.keyDown(tabOf('A'), { key: 'ArrowRight' });
    fireEvent.keyDown(tabOf('B'), { key: 'ArrowRight' });
    expect(tabOf('C')).toHaveFocus();
    expect(tabOf('C')).toHaveAttribute('aria-selected', 'true');
    expect(tabIndexes()).toEqual(['-1', '-1', '0']);
    fireEvent.keyDown(tabOf('C'), { key: 'Home' });
    expect(tabOf('A')).toHaveFocus();
    expect(tabIndexes()).toEqual(['0', '-1', '-1']);
  });
});

describe('SegmentedTabs: bộ đếm (count)', () => {
  const withCounts = [
    { key: 'n', label: 'Số', count: 12 },
    { key: 'z', label: 'Không', count: 0 },
    { key: 's', label: 'Chuỗi', count: '99+' },
    { key: 'x', label: 'Trống' },
  ];

  it('vẽ count kiểu số (kể cả 0) và kiểu chuỗi, số đều (tabular-nums) để bề rộng tab không nhảy khi số đổi', () => {
    render(<SegmentedTabs items={withCounts} value="n" onChange={() => {}} />);
    for (const text of ['12', '0', '99+']) {
      const badge = screen.getByText(text);
      expect(badge.tagName).toBe('SPAN');
      expect(badge.style.fontVariantNumeric).toBe('tabular-nums');
      expect(badge).toHaveStyle({ marginLeft: '4px', opacity: '0.75' });
    }
  });

  it('không có count thì không vẽ bộ đếm', () => {
    render(<SegmentedTabs items={withCounts} value="n" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Trống' }).querySelector('span')).toBeNull();
  });
});
