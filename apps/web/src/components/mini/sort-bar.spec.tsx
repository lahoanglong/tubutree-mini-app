// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
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
