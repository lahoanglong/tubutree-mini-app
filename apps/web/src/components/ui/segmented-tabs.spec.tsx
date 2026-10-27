// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, render, type Rendered } from '@/test-utils/dom';

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/tai-khoan/don-hang',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { SegmentedTabs, useTabParam } from './segmented-tabs';

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  nav.replace.mockClear();
  nav.search = '';
});

const ITEMS = [
  { key: 'a', label: 'Tất cả', count: 3 },
  { key: 'b', label: 'Đang giao' },
];

describe('SegmentedTabs: mép mờ khi cuộn ngang', () => {
  it('scroll: có lớp mờ mép như Mini App; không scroll thì không', () => {
    const on = mount(<SegmentedTabs items={ITEMS} value="a" onChange={() => {}} scroll />);
    expect(on.container.querySelector('[role="tablist"]')!.className).toContain('tubu-scroll-fade');
    const off = mount(<SegmentedTabs items={ITEMS} value="a" onChange={() => {}} />);
    expect(off.container.querySelector('[role="tablist"]')!.className).not.toContain('tubu-scroll-fade');
  });
});

describe('SegmentedTabs', () => {
  it('role tablist/tab, tab đang chọn aria-selected, có số đếm, vùng chạm 44px', () => {
    const { container } = mount(<SegmentedTabs items={ITEMS} value="b" onChange={() => {}} />);
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]!.textContent).toBe('Tất cả3');
    expect(tabs[0]!.className).toContain('min-h-11');
  });

  it('bấm gọi onChange với key; mũi tên phải chuyển tab kế, quay vòng', () => {
    const onChange = vi.fn();
    const { container } = mount(<SegmentedTabs items={ITEMS} value="b" onChange={onChange} />);
    click(container.querySelectorAll('[role="tab"]')[0]!);
    expect(onChange).toHaveBeenLastCalledWith('a');
    act(() => {
      container.querySelector('[role="tablist"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });
});

function Probe() {
  const [tab, setTab] = useTabParam(['a', 'b'], 'a');
  return (
    <button data-tab={tab} onClick={() => setTab(tab === 'a' ? 'b' : 'a')}>
      đổi
    </button>
  );
}

describe('useTabParam', () => {
  it('đọc ?tab=; giá trị lạ hoặc thiếu rơi về mặc định', () => {
    nav.search = 'tab=b';
    expect(mount(<Probe />).container.querySelector('button')!.dataset.tab).toBe('b');
    nav.search = 'tab=zzz';
    expect(mount(<Probe />).container.querySelector('button')!.dataset.tab).toBe('a');
  });

  it('đổi tab ghi ?tab= bằng replace, giữ tham số khác; về mặc định thì bỏ tab', () => {
    nav.search = 'q=1';
    click(mount(<Probe />).container.querySelector('button'));
    expect(nav.replace).toHaveBeenLastCalledWith('/tai-khoan/don-hang?q=1&tab=b', { scroll: false });
    nav.search = 'tab=b';
    click(mount(<Probe />).container.querySelector('button'));
    expect(nav.replace).toHaveBeenLastCalledWith('/tai-khoan/don-hang', { scroll: false });
  });
});
