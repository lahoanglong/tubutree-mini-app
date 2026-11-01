// @vitest-environment jsdom
import { useState } from 'react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SlotTab } from '@tubutree/app-core/commerce/flash-slots';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
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

const tabs = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const key = (k: string) =>
  act(() => {
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });

describe('SlotTabs (web)', () => {
  it('tablist có tên "Khung giờ"; mỗi tab đọc "12:00, đang diễn ra", chỉ tab đang chọn nằm trong thứ tự Tab', () => {
    mount(<Harness />);
    expect(document.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Khung giờ');
    expect(tabs().map((t) => t.getAttribute('aria-label'))).toEqual(['12:00, đang diễn ra', '20:00, sắp diễn ra', '12:00, ngày mai']);
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it('mỗi tab trỏ vào tabpanel qua aria-controls và panel gắn lại bằng aria-labelledby', () => {
    mount(<Harness />);
    for (const tab of tabs()) expect(tab.getAttribute('aria-controls')).toBe('slot-panel');
    expect(document.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe(slotTabId('a'));
    expect(tabs()[0]!.id).toBe(slotTabId('a'));
  });

  it('hiện giờ và chú thích bằng chữ nhìn thấy', () => {
    mount(<Harness />);
    expect(tabs()[0]!.textContent).toBe('12:00Đang diễn ra');
    expect(tabs()[2]!.textContent).toBe('12:00Ngày mai');
  });

  it('ArrowRight/ArrowLeft chọn tab kế và chuyển tiêu điểm theo (quay vòng)', () => {
    const onChange = vi.fn();
    mount(<Harness onChange={onChange} />);
    tabs()[0]!.focus();
    key('ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(document.activeElement).toBe(tabs()[1]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    key('ArrowRight');
    key('ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('a');
    expect(document.activeElement).toBe(tabs()[0]);
    key('ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(document.activeElement).toBe(tabs()[2]);
  });

  it('Home và End nhảy tới tab đầu và cuối', () => {
    mount(<Harness initial="b" />);
    tabs()[1]!.focus();
    key('End');
    expect(document.activeElement).toBe(tabs()[2]);
    key('Home');
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it('phím chữ không làm gì', () => {
    const onChange = vi.fn();
    mount(<Harness onChange={onChange} />);
    tabs()[1]!.focus();
    key('x');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('bấm chọn tab, tab đang chọn có gạch chân 3px bằng token viền chọn và đủ vùng chạm 44px', () => {
    const onChange = vi.fn();
    mount(<Harness onChange={onChange} />);
    click(tabs()[1]!);
    expect(onChange).toHaveBeenCalledWith('b');
    const [other, selected] = tabs();
    expect(selected!.style.boxShadow).toContain('3px');
    expect(selected!.style.boxShadow).toContain('var(--color-border-selected)');
    expect(other!.style.boxShadow).toBe('');
    expect(Number.parseInt(selected!.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });

  it('không có tab thì không vẽ gì', () => {
    const m = mount(<SlotTabs tabs={[]} value="" onChange={() => {}} panelId="p" />);
    expect(m.container.innerHTML).toBe('');
  });
});
