// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { click, typeInto } from '@/test-utils/dom';
import { mount } from './harness';

const nav = vi.hoisted(() => ({ pathname: '/san-pham/abc', back: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ back: nav.back, push: nav.push }),
}));

import BackButton from './back-button';
import { SegmentedTabs } from './segmented-tabs';
import { ScrollRow } from './scroll-row';
import { SearchField } from './search-field';

beforeEach(() => {
  nav.pathname = '/san-pham/abc';
  nav.back.mockClear();
  nav.push.mockClear();
  document.body.className = '';
  try { sessionStorage.clear(); } catch { /* không có */ }
});

describe('BackButton', () => {
  it('trang con: nút tròn nổi 44px trên-trái, nhãn "Quay lại", gắn with-back-btn lên body', () => {
    const b = mount(<BackButton />).container.querySelector('button')!;
    expect(b.getAttribute('aria-label')).toBe('Quay lại');
    expect(b.style.position).toBe('fixed');
    expect(b.style.left).toBe('12px');
    expect(b.style.width).toBe('44px');
    expect(b.style.borderRadius).toBe('50%');
    expect(b.style.top).toBe('calc(var(--safe-top) + 8px)');
    expect(document.body.classList.contains('with-back-btn')).toBe(true);
  });

  it.each(['/', '/san-pham', '/vuon-xanh', '/tai-khoan/don-hang', '/tai-khoan'])('ẩn ở trang gốc %s', (p) => {
    nav.pathname = p;
    expect(mount(<BackButton />).container.querySelector('button')).toBeNull();
    expect(document.body.classList.contains('with-back-btn')).toBe(false);
  });

  it('gỡ with-back-btn khi gỡ nút', () => {
    const m = mount(<BackButton />);
    m.unmount();
    expect(document.body.classList.contains('with-back-btn')).toBe(false);
    m.container.remove();
  });

  it('đã đi qua trang trong app thì lùi; mở thẳng (kể cả từ quảng cáo ngoài, history.length 2) thì về fallbackHref', () => {
    nav.pathname = '/san-pham/abc';
    let bump = () => {};
    function Host() {
      const [, set] = useState(0);
      bump = () => set((n) => n + 1);
      return <BackButton fallbackHref="/s/abc" />;
    }
    const m = mount(<Host />);
    const b = m.container.querySelector('button')!;
    const spy = vi.spyOn(window.history, 'length', 'get');
    spy.mockReturnValue(2);
    click(b);
    expect(nav.push).toHaveBeenCalledWith('/s/abc');
    expect(nav.back).not.toHaveBeenCalled();
    nav.pathname = '/gio-hang';
    act(() => bump());
    click(m.container.querySelector('button')!);
    expect(nav.back).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('BackButton độ sâu', () => {
  function setup() {
    let bump = () => {};
    function Host() {
      const [, set] = useState(0);
      bump = () => set((n) => n + 1);
      return <BackButton />;
    }
    const m = mount(<Host />);
    const go = (path: string, popped = false) => {
      nav.pathname = path;
      if (popped) window.dispatchEvent(new PopStateEvent('popstate'));
      act(() => bump());
    };
    return { m, go };
  }

  it('A→B rồi lùi về A (popstate) thì nút ở A quay về "/" chứ không back() ra khỏi site', () => {
    nav.pathname = '/san-pham/a';
    const { m, go } = setup();
    go('/san-pham/b');
    go('/san-pham/a', true);
    click(m.container.querySelector('button')!);
    expect(nav.push).toHaveBeenCalledWith('/');
    expect(nav.back).not.toHaveBeenCalled();
  });

  it('A→B: ở B vẫn back()', () => {
    nav.pathname = '/san-pham/a';
    const { m, go } = setup();
    go('/san-pham/b');
    click(m.container.querySelector('button')!);
    expect(nav.back).toHaveBeenCalledTimes(1);
  });

  it('độ sâu giữ qua F5 (sessionStorage)', () => {
    nav.pathname = '/san-pham/a';
    const { go } = setup();
    go('/san-pham/b');
    const m2 = mount(<BackButton />);
    nav.pathname = '/san-pham/b';
    click(m2.container.querySelector('button')!);
    expect(nav.back).toHaveBeenCalledTimes(1);
  });

  it('nút nổi thấp hơn Sheet (z-50) và OnboardingGate (z-60) để lớp phủ che được nó', () => {
    const b = mount(<BackButton />).container.querySelector('button')!;
    expect(Number(b.style.zIndex)).toBeLessThan(50);
  });

  it('hai bản cùng gắn: gỡ một bản không làm mất with-back-btn của bản còn lại', () => {
    const a = mount(<BackButton />);
    mount(<BackButton />);
    a.unmount();
    expect(document.body.classList.contains('with-back-btn')).toBe(true);
    a.container.remove();
  });
});

describe('SegmentedTabs', () => {
  const items = [{ key: 'a', label: 'Tất cả', count: 3 }, { key: 'b', label: 'Đang giao' }];

  it('tablist/tab, tab đang chọn aria-selected, mỗi tab cao tối thiểu 44px', () => {
    const c = mount(<SegmentedTabs items={items} value="b" onChange={() => {}} />).container;
    expect(c.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = Array.from(c.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(tabs[0]!.textContent).toBe('Tất cả3');
    expect(tabs[0]!.style.minHeight).toBe('44px');
    expect(tabs[1]!.style.background).toBe('var(--color-bg-surface)');
  });

  it('bấm tab gọi onChange với key', () => {
    const onChange = vi.fn();
    const c = mount(<SegmentedTabs items={items} value="a" onChange={onChange} />).container;
    click(c.querySelectorAll('[role="tab"]')[1]!);
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('scroll: hàng cuộn ngang mờ mép, tab không co', () => {
    const c = mount(<SegmentedTabs items={items} value="a" onChange={() => {}} scroll />).container;
    expect(c.firstElementChild!.className).toBe('scroll-x tubu-scroll-fade');
    expect((c.querySelector('[role="tab"]') as HTMLElement).style.flex).toBe('0 0 auto');
  });
});

describe('ScrollRow', () => {
  it('vùng có tên, cuộn ngang, mờ mép', () => {
    const c = mount(<ScrollRow label="Dải thương hiệu"><button>A</button></ScrollRow>).container;
    const r = c.querySelector('[role="region"]')!;
    expect(r.getAttribute('aria-label')).toBe('Dải thương hiệu');
    expect(r.className).toBe('scroll-x tubu-scroll-fade');
  });
});

describe('SearchField', () => {
  const props = { label: 'Tìm sản phẩm', clearLabel: 'Xoá từ khoá', placeholder: 'Tìm…' };

  it('form role=search, ô type=search có nhãn, cao tối thiểu 44px; rỗng thì không có nút xoá', () => {
    const c = mount(<SearchField value="" onChange={() => {}} onSubmit={() => {}} {...props} />).container;
    expect(c.querySelector('form[role="search"]')).not.toBeNull();
    const input = c.querySelector('input')!;
    expect(input.type).toBe('search');
    expect(input.getAttribute('aria-label')).toBe('Tìm sản phẩm');
    expect(input.placeholder).toBe('Tìm…');
    expect((c.querySelector('[data-testid="search-field-box"]') as HTMLElement).style.minHeight).toBe('44px');
    expect(c.querySelector('[aria-label="Xoá từ khoá"]')).toBeNull();
  });

  it('gõ gọi onChange; Enter (submit) gọi onSubmit với giá trị hiện tại', () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const c = mount(<SearchField value="sữa" onChange={onChange} onSubmit={onSubmit} {...props} />).container;
    typeInto(c.querySelector('input'), 'sữa hạt');
    expect(onChange).toHaveBeenCalledWith('sữa hạt');
    act(() => { c.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(onSubmit).toHaveBeenCalledWith('sữa');
  });

  it('nút xoá có nhãn: gọi onClear (hoặc onChange rỗng) và trả focus về ô nhập', () => {
    const onChange = vi.fn();
    const c = mount(<SearchField value="abc" onChange={onChange} onSubmit={() => {}} {...props} />).container;
    click(c.querySelector('[aria-label="Xoá từ khoá"]'));
    expect(onChange).toHaveBeenCalledWith('');
    expect(document.activeElement).toBe(c.querySelector('input'));
    const onClear = vi.fn();
    const c2 = mount(<SearchField value="abc" onChange={onChange} onClear={onClear} onSubmit={() => {}} {...props} />).container;
    click(c2.querySelector('[aria-label="Xoá từ khoá"]'));
    expect(onClear).toHaveBeenCalled();
  });
});
