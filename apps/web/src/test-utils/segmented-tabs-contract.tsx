/**
 * Hợp đồng chung cho hai bản `SegmentedTabs` của web (`components/mini` và `components/ui`): cùng bàn phím, cùng roving tabindex, cùng bộ đếm.
 * Mỗi spec gọi một lần bên trong `describe`. CHỈ dùng trong *.spec.tsx.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { act, useState, type ComponentType, type ReactElement } from 'react';
import { render, type Rendered } from '@/test-utils/dom';

interface TabsProps {
  items: { key: string; label: string; count?: number | string }[];
  value: string;
  onChange: (key: string) => void;
}

const THREE = [
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
  { key: 'c', label: 'C' },
];

export function segmentedTabsContract(Tabs: ComponentType<TabsProps>, countIsTabular: (badge: HTMLElement) => boolean) {
  let mounted: Rendered[] = [];
  afterEach(() => {
    mounted.forEach((m) => m.unmount());
    mounted = [];
  });
  const mount = (ui: ReactElement) => {
    const r = render(ui);
    mounted.push(r);
    return r.container;
  };
  const tabsIn = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const tabOf = (c: HTMLElement, label: string) => tabsIn(c).find((t) => t.textContent === label)!;
  const tabIndexes = (c: HTMLElement) => tabsIn(c).map((t) => t.getAttribute('tabindex'));
  const press = (el: HTMLElement, key: string, mods: KeyboardEventInit = {}): boolean => {
    let notPrevented = true;
    act(() => {
      notPrevented = el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));
    });
    return notPrevented;
  };

  function Stateful({ initial }: { initial: string }) {
    const [value, setValue] = useState(initial);
    return <Tabs items={THREE} value={value} onChange={setValue} />;
  }

  it('chỉ tab đang chọn nằm trong thứ tự Tab, tab khác tabindex -1; đổi chọn thì điểm dừng đi theo', () => {
    const c = mount(<Stateful initial="b" />);
    expect(tabIndexes(c)).toEqual(['-1', '0', '-1']);
    act(() => tabOf(c, 'C').click());
    expect(tabIndexes(c)).toEqual(['-1', '-1', '0']);
  });

  it('value không khớp tab nào: tab đầu giữ điểm dừng Tab, không tab nào aria-selected', () => {
    const c = mount(<Tabs items={THREE} value="zzz" onChange={() => {}} />);
    expect(tabIndexes(c)).toEqual(['0', '-1', '-1']);
    expect(tabsIn(c).map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false']);
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
    const c = mount(<Tabs items={THREE} value={from} onChange={onChange} />);
    const source = tabOf(c, from.toUpperCase());
    source.focus();
    expect(press(source, key)).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(to.toLowerCase());
    expect(document.activeElement).toBe(tabOf(c, to));
  });

  it('phím tính theo tab đang bấm phím, không theo tab đang chọn', () => {
    const onChange = vi.fn();
    const c = mount(<Tabs items={THREE} value="a" onChange={onChange} />);
    const source = tabOf(c, 'B');
    source.focus();
    press(source, 'ArrowRight');
    expect(onChange).toHaveBeenCalledWith('c');
    expect(document.activeElement).toBe(tabOf(c, 'C'));
  });

  it.each(['Enter', ' ', 'ArrowUp', 'ArrowDown', 'Tab', 'a'])('phím %j không đổi tab và không bị chặn mặc định', (key) => {
    const onChange = vi.fn();
    const c = mount(<Tabs items={THREE} value="a" onChange={onChange} />);
    const source = tabOf(c, 'A');
    source.focus();
    expect(press(source, key)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(source);
  });

  it.each(['altKey', 'ctrlKey', 'metaKey'])('giữ %s thì mũi tên thuộc về trình duyệt (vd Alt+← là Back): không đổi tab, không chặn mặc định', (modifier) => {
    const onChange = vi.fn();
    const c = mount(<Tabs items={THREE} value="a" onChange={onChange} />);
    const source = tabOf(c, 'A');
    source.focus();
    expect(press(source, 'ArrowRight', { [modifier]: true })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('luồng đủ: mũi tên đổi tab, tiêu điểm đi theo, điểm dừng Tab đi theo tab mới', () => {
    const c = mount(<Stateful initial="a" />);
    tabOf(c, 'A').focus();
    press(tabOf(c, 'A'), 'ArrowRight');
    press(tabOf(c, 'B'), 'ArrowRight');
    expect(document.activeElement).toBe(tabOf(c, 'C'));
    expect(tabOf(c, 'C').getAttribute('aria-selected')).toBe('true');
    expect(tabIndexes(c)).toEqual(['-1', '-1', '0']);
    press(tabOf(c, 'C'), 'Home');
    expect(document.activeElement).toBe(tabOf(c, 'A'));
    expect(tabIndexes(c)).toEqual(['0', '-1', '-1']);
  });

  it('vẽ count kiểu số (kể cả 0) và kiểu chuỗi, số đều (tabular-nums) để bề rộng tab không nhảy khi số đổi', () => {
    const c = mount(
      <Tabs
        items={[
          { key: 'n', label: 'Số', count: 12 },
          { key: 'z', label: 'Không', count: 0 },
          { key: 's', label: 'Chuỗi', count: '99+' },
          { key: 'x', label: 'Trống' },
        ]}
        value="n"
        onChange={() => {}}
      />,
    );
    const badges = tabsIn(c).map((t) => t.querySelector<HTMLElement>('span'));
    expect(badges.map((b) => b?.textContent ?? null)).toEqual(['12', '0', '99+', null]);
    for (const badge of badges.slice(0, 3)) expect(countIsTabular(badge!)).toBe(true);
  });
}
