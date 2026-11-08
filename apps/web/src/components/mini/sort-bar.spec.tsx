// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { SortBar, type SortOption } from './sort-bar';

const OPTIONS: SortOption[] = [
  { value: 'popular', label: 'Phổ biến' },
  { value: 'best', label: 'Bán chạy' },
  { value: 'new', label: 'Mới' },
  { value: 'price', label: 'Giá ⇅', spoken: 'Giá, đổi chiều sắp xếp' },
];
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
const byLabel = (t: string) => buttons().find((b) => (b.getAttribute('aria-label') ?? b.textContent) === t)!;

describe('SortBar (web)', () => {
  it('nhóm "Sắp xếp", chỉ nút của value có aria-pressed="true"', () => {
    mount(<SortBar value="best" options={OPTIONS} onChange={() => {}} />);
    expect(document.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Sắp xếp');
    expect(buttons()).toHaveLength(4);
    expect(byLabel('Bán chạy').getAttribute('aria-pressed')).toBe('true');
    expect(byLabel('Phổ biến').getAttribute('aria-pressed')).toBe('false');
  });

  it('A11Y-07: tên của tab giá bắt đầu bằng chữ nhìn thấy; gợi ý "Chạm để đổi chiều" nằm ở aria-describedby, không ở tên', () => {
    mount(<SortBar value="price" options={[{ value: 'price', label: 'Giá thấp', spoken: 'Giá thấp, từ thấp đến cao', hint: 'Chạm để đổi chiều' }]} onChange={() => {}} />);
    const btn = byLabel('Giá thấp, từ thấp đến cao');
    expect(btn.getAttribute('aria-label')!.startsWith(btn.textContent!)).toBe(true);
    expect(btn.getAttribute('aria-label')).not.toMatch(/chạm/i);
    expect(document.getElementById(btn.getAttribute('aria-describedby')!)!.textContent).toBe('Chạm để đổi chiều');
  });

  it('bấm tab gọi onChange(value), kể cả tab đang chọn', () => {
    const onChange = vi.fn();
    mount(<SortBar value="price" options={OPTIONS} onChange={onChange} />);
    click(byLabel('Bán chạy'));
    expect(onChange).toHaveBeenLastCalledWith('best');
    click(byLabel('Giá, đổi chiều sắp xếp'));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('price');
  });

  it('tab đang chọn: gạch chân 2px + chữ thương hiệu; value ngoài options: không nút nào pressed', () => {
    const m = mount(<SortBar value="best" options={OPTIONS} onChange={() => {}} />);
    expect(byLabel('Bán chạy').style.boxShadow).toContain('var(--color-border-selected)');
    expect(byLabel('Bán chạy').style.color).toBe('var(--color-text-brand)');
    m.unmount();
    mount(<SortBar value="khong-co" options={OPTIONS} onChange={() => {}} />);
    for (const b of buttons()) expect(b.getAttribute('aria-pressed')).toBe('false');
  });

  it('filterCount=2: "Lọc (2)" tên đọc "Lọc, 2 bộ lọc đang bật"; 0/-1/NaN/thiếu: "Lọc" trơn', () => {
    const onFilter = vi.fn();
    const a = mount(<SortBar value="best" options={OPTIONS} onChange={() => {}} filterCount={2} onFilter={onFilter} />);
    const btn = byLabel('Lọc, 2 bộ lọc đang bật');
    expect(btn.textContent).toBe('Lọc (2)');
    click(btn);
    expect(onFilter).toHaveBeenCalledTimes(1);
    a.unmount();
    for (const n of [0, -1, Number.NaN, undefined]) {
      const m = mount(<SortBar value="best" options={OPTIONS} onChange={() => {}} filterCount={n} onFilter={() => {}} />);
      const f = buttons().find((b) => b.textContent === 'Lọc')!;
      expect(f, String(n)).toBeTruthy();
      expect(f.hasAttribute('aria-label')).toBe(false);
      m.unmount();
    }
  });

  it('không onFilter thì không nút Lọc; options rỗng và không onFilter thì render rỗng', () => {
    const a = mount(<SortBar value="best" options={OPTIONS} onChange={() => {}} filterCount={3} />);
    expect(buttons().some((b) => b.textContent!.startsWith('Lọc'))).toBe(false);
    a.unmount();
    const b = mount(<SortBar value="" options={[]} onChange={() => {}} />);
    expect(b.container.innerHTML).toBe('');
  });

  it('đệm ngang 8px, tab dãn chứ không co: bộ nhãn BR-01 + "Lọc (3)" vừa hàng 343px (đo Playwright ở gallery, 375px)', () => {
    mount(<SortBar value="best" options={OPTIONS} onChange={() => {}} filterCount={3} onFilter={() => {}} />);
    for (const b of buttons()) expect(b.style.padding).toBe('0px 8px');
    const group = document.querySelector('[role="group"]')!;
    for (const b of Array.from(group.querySelectorAll('button'))) expect(b.style.flex).toBe('1 0 auto');
  });

  it('sticky dính dưới --sort-bar-top; mọi nút cao tối thiểu 44px', () => {
    const m = mount(<SortBar value="best" options={OPTIONS} onChange={() => {}} sticky filterCount={1} onFilter={() => {}} />);
    const root = m.container.firstElementChild as HTMLElement;
    expect(root.style.position).toBe('sticky');
    expect(root.style.top).toBe('var(--sort-bar-top, 0px)');
    for (const b of buttons()) expect(b.style.minHeight).toBe('44px');
  });

  it('hàng tab cuộn ngang có mờ mép; tab đang chọn nằm ngoài khung thì cuộn ngang hàng vào, không kéo trang', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 44, width: right - left, height: 44, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'group') return rect(0, 300);
      return this.getAttribute('aria-pressed') === 'true' ? rect(350, 420) : rect(0, 0);
    });
    const a = mount(<SortBar value="best" options={OPTIONS} onChange={() => {}} filterCount={3} onFilter={() => {}} />);
    const group = document.querySelector<HTMLElement>('[role="group"]')!;
    expect(group.className).toContain('tubu-scroll-fade');
    expect(group.scrollLeft).toBe(120);
    a.unmount();
    spy.mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'group') return rect(0, 300);
      return this.getAttribute('aria-pressed') === 'true' ? rect(100, 160) : rect(0, 0);
    });
    mount(<SortBar value="price" options={OPTIONS} onChange={() => {}} filterCount={3} onFilter={() => {}} />);
    expect(document.querySelectorAll<HTMLElement>('[role="group"]')[0]!.scrollLeft).toBe(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
    spy.mockRestore();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  describe('bàn phím: mũi tên, Home, End (như SlotTabs)', () => {
    function Controlled({ onChange = () => {} }: { onChange?: (v: string) => void }) {
      const [value, setValue] = useState('best');
      return (
        <SortBar
          value={value}
          options={OPTIONS}
          onChange={(v) => {
            setValue(v);
            onChange(v);
          }}
        />
      );
    }
    /** Trả `true` khi phím không bị chặn mặc định. */
    const press = (target: Element, k: string, init: KeyboardEventInit = {}) => {
      let notPrevented = true;
      act(() => {
        notPrevented = target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
      });
      return notPrevented;
    };
    const key = (k: string) => press(document.activeElement!, k);

    it('ArrowRight/ArrowLeft chọn mục kế và chuyển tiêu điểm theo, quay vòng hai đầu', () => {
      const onChange = vi.fn();
      mount(<Controlled onChange={onChange} />);
      byLabel('Bán chạy').focus();
      key('ArrowRight');
      expect(onChange).toHaveBeenLastCalledWith('new');
      expect(document.activeElement).toBe(byLabel('Mới'));
      expect(byLabel('Mới').getAttribute('aria-pressed')).toBe('true');
      key('ArrowRight');
      key('ArrowRight');
      expect(onChange).toHaveBeenLastCalledWith('popular');
      expect(document.activeElement).toBe(byLabel('Phổ biến'));
      key('ArrowLeft');
      expect(onChange).toHaveBeenLastCalledWith('price');
      expect(document.activeElement).toBe(byLabel('Giá, đổi chiều sắp xếp'));
      expect(onChange).toHaveBeenCalledTimes(4);
    });

    it('Home về mục đầu, End tới mục cuối, kèm tiêu điểm', () => {
      const onChange = vi.fn();
      mount(<Controlled onChange={onChange} />);
      byLabel('Bán chạy').focus();
      key('End');
      expect(onChange).toHaveBeenLastCalledWith('price');
      expect(document.activeElement).toBe(byLabel('Giá, đổi chiều sắp xếp'));
      key('Home');
      expect(onChange).toHaveBeenLastCalledWith('popular');
      expect(document.activeElement).toBe(byLabel('Phổ biến'));
    });

    it('phím đã xử lý bị chặn mặc định (Home/End không cuộn trang)', () => {
      mount(<SortBar value="best" options={OPTIONS} onChange={() => {}} />);
      for (const k of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
        expect(press(byLabel('Bán chạy'), k), k).toBe(false);
      }
    });

    it('Home ở mục đầu và End ở mục cuối không gọi onChange (bấm lại "Giá" sẽ đảo chiều) nhưng vẫn chặn cuộn trang', () => {
      const onChange = vi.fn();
      mount(<SortBar value="price" options={OPTIONS} onChange={onChange} />);
      const last = byLabel('Giá, đổi chiều sắp xếp');
      last.focus();
      expect(press(last, 'End')).toBe(false);
      expect(document.activeElement).toBe(last);
      const first = byLabel('Phổ biến');
      first.focus();
      expect(press(first, 'Home')).toBe(false);
      expect(document.activeElement).toBe(first);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('tiêu điểm lệch mục đang chọn: phím tới đúng mục đang chọn chỉ dời tiêu điểm, không gọi onChange (tránh đảo chiều "Giá")', () => {
      const onChange = vi.fn();
      mount(<SortBar value="price" options={OPTIONS} onChange={onChange} />);
      byLabel('Mới').focus();
      expect(press(byLabel('Mới'), 'End')).toBe(false);
      expect(document.activeElement).toBe(byLabel('Giá, đổi chiều sắp xếp'));
      byLabel('Phổ biến').focus();
      expect(press(byLabel('Phổ biến'), 'ArrowLeft')).toBe(false);
      expect(document.activeElement).toBe(byLabel('Giá, đổi chiều sắp xếp'));
      expect(onChange).not.toHaveBeenCalled();
      byLabel('Bán chạy').focus();
      press(byLabel('Bán chạy'), 'ArrowRight');
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith('new');
      expect(document.activeElement).toBe(byLabel('Mới'));
    });

    it('Alt/Ctrl/Meta + mũi tên không bị chặn và không đổi mục (Alt+← là Quay lại của trình duyệt)', () => {
      const onChange = vi.fn();
      mount(<SortBar value="best" options={OPTIONS} onChange={onChange} />);
      for (const mod of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
        expect(press(byLabel('Bán chạy'), 'ArrowLeft', mod), JSON.stringify(mod)).toBe(true);
      }
      expect(onChange).not.toHaveBeenCalled();
    });

    it('chỉ một mục: mũi tên không gọi onChange', () => {
      const onChange = vi.fn();
      mount(<SortBar value="best" options={[OPTIONS[1]!]} onChange={onChange} />);
      press(byLabel('Bán chạy'), 'ArrowRight');
      press(byLabel('Bán chạy'), 'ArrowLeft');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('phím khác (Enter, Space, Tab, chữ, mũi tên lên xuống) không bị chặn và không gọi onChange', () => {
      const onChange = vi.fn();
      mount(<SortBar value="best" options={OPTIONS} onChange={onChange} filterCount={1} onFilter={() => {}} />);
      for (const k of ['Enter', ' ', 'Tab', 'a', 'ArrowUp', 'ArrowDown']) {
        expect(press(byLabel('Bán chạy'), k), k).toBe(true);
      }
      expect(press(byLabel('Lọc, 1 bộ lọc đang bật'), 'ArrowRight')).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('filterExpanded', () => {
    it.each([[false], [true]])('filterExpanded=%s: nút Lọc có aria-expanded và aria-haspopup="dialog"', (expanded) => {
      mount(<SortBar value="best" options={OPTIONS} onChange={() => {}} onFilter={() => {}} filterExpanded={expanded} />);
      const filter = byLabel('Lọc');
      expect(filter.getAttribute('aria-expanded')).toBe(String(expanded));
      expect(filter.getAttribute('aria-haspopup')).toBe('dialog');
      for (const b of Array.from(document.querySelector('[role="group"]')!.querySelectorAll('button'))) {
        expect(b.hasAttribute('aria-expanded')).toBe(false);
        expect(b.hasAttribute('aria-haspopup')).toBe(false);
      }
    });

    it('không truyền filterExpanded: nút Lọc giữ nguyên, không aria-expanded, không aria-haspopup', () => {
      mount(<SortBar value="best" options={OPTIONS} onChange={() => {}} onFilter={() => {}} />);
      const filter = byLabel('Lọc');
      expect(filter.hasAttribute('aria-expanded')).toBe(false);
      expect(filter.hasAttribute('aria-haspopup')).toBe(false);
    });

    it('có filterCount: tên đọc vẫn là "Lọc, 2 bộ lọc đang bật" cùng aria-expanded', () => {
      mount(<SortBar value="best" options={OPTIONS} onChange={() => {}} onFilter={() => {}} filterCount={2} filterExpanded />);
      expect(byLabel('Lọc, 2 bộ lọc đang bật').getAttribute('aria-expanded')).toBe('true');
    });
  });

  it('options rỗng rồi có lại trên cùng một cây: không lỗi hook (hook đứng trước return sớm)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => root.render(<SortBar value="" options={[]} onChange={() => {}} />));
    expect(el.innerHTML).toBe('');
    act(() => root.render(<SortBar value="best" options={OPTIONS} onChange={() => {}} />));
    expect(el.querySelector('[role="group"]')).not.toBeNull();
    act(() => root.unmount());
    el.remove();
  });
});
