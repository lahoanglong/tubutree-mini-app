import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SlotTab } from '@tubutree/app-core/commerce/flash-slots';
import { SlotTabs, slotTabId } from './slot-tabs';

const TABS: SlotTab[] = [
  { id: 'a', clock: '12:00', caption: 'Đang diễn ra', spoken: '12:00, đang diễn ra', status: 'LIVE' },
  { id: 'b', clock: '20:00', caption: 'Sắp diễn ra', spoken: '20:00, sắp diễn ra', status: 'UPCOMING' },
  { id: 'c', clock: '12:00', caption: 'Ngày mai', spoken: '12:00, ngày mai', status: 'UPCOMING' },
];

function Harness({ onChange = () => {}, initial = 'a' }: { onChange?: (id: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <SlotTabs
        tabs={TABS}
        value={value}
        onChange={(id) => {
          setValue(id);
          onChange(id);
        }}
        panelId="slot-panel"
      />
      <div id="slot-panel" role="tabpanel" tabIndex={0} aria-labelledby={slotTabId(value)}>
        nội dung
      </div>
    </>
  );
}

describe('SlotTabs', () => {
  it('tablist có tên "Khung giờ"; mỗi tab đọc "12:00, đang diễn ra", chỉ tab đang chọn nằm trong thứ tự Tab', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Khung giờ' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(['12:00, đang diễn ra', '20:00, sắp diễn ra', '12:00, ngày mai']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it('mỗi tab trỏ vào tabpanel qua aria-controls và panel gắn lại bằng aria-labelledby', () => {
    render(<Harness />);
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveAttribute('aria-controls', 'slot-panel');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', slotTabId('a'));
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('id', slotTabId('a'));
  });

  it('hiện giờ và chú thích bằng chữ nhìn thấy', () => {
    render(<Harness />);
    expect(screen.getByText('Đang diễn ra')).toBeVisible();
    expect(screen.getByText('Ngày mai')).toBeVisible();
    expect(screen.getAllByText('12:00')).toHaveLength(2);
  });

  it('ArrowRight/ArrowLeft chọn tab kế và chuyển tiêu điểm theo (quay vòng)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const tabs = screen.getAllByRole('tab');
    tabs[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(tabs[1]).toHaveFocus();
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('a');
    expect(tabs[0]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(tabs[2]).toHaveFocus();
  });

  it('Home và End nhảy tới tab đầu và cuối', async () => {
    const user = userEvent.setup();
    render(<Harness initial="b" />);
    const tabs = screen.getAllByRole('tab');
    tabs[1]!.focus();
    await user.keyboard('{End}');
    expect(tabs[2]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tabs[0]).toHaveFocus();
  });

  it('Enter và Space chọn tab đang giữ tiêu điểm; phím chữ không làm gì', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const tabs = screen.getAllByRole('tab');
    tabs[1]!.focus();
    await user.keyboard('x');
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('b');
    tabs[2]!.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith('c');
  });

  it('bấm chuột chọn tab, tiêu điểm ở lại chính tab đó (không nhảy vào panel)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const tabs = screen.getAllByRole('tab');
    await user.click(tabs[1]!);
    expect(onChange).toHaveBeenCalledWith('b');
    expect(tabs[1]).toHaveFocus();
    expect(screen.getByRole('tabpanel')).not.toHaveFocus();
  });

  it('tab đang chọn có gạch chân 3px bằng token viền chọn; các tab đủ vùng chạm 44px', () => {
    render(<Harness />);
    const [selected, other] = screen.getAllByRole('tab');
    expect(selected!.style.boxShadow).toContain('3px');
    expect(selected!.style.boxShadow).toContain('var(--color-border-selected)');
    expect(other!.style.boxShadow).toBe('');
    expect(Number.parseInt(selected!.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });

  it('không có tab thì không vẽ gì', () => {
    const { container } = render(<SlotTabs tabs={[]} value="" onChange={() => {}} panelId="p" />);
    expect(container).toBeEmptyDOMElement();
  });
});
