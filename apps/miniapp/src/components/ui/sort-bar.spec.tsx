import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SortBar, type SortOption } from './sort-bar';

const OPTIONS: SortOption[] = [
  { value: 'popular', label: 'Phổ biến' },
  { value: 'best', label: 'Bán chạy' },
  { value: 'new', label: 'Mới' },
  { value: 'price', label: 'Giá ⇅', spoken: 'Giá, đổi chiều sắp xếp' },
];

describe('SortBar', () => {
  it('mỗi option một nút; chỉ nút của value có aria-pressed="true"', () => {
    render(<SortBar value="best" options={OPTIONS} onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Sắp xếp' });
    expect(group.querySelectorAll('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Bán chạy' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Phổ biến' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('bấm tab gọi onChange(value); bấm lại tab đang chọn vẫn gọi (đảo chiều giá)', () => {
    const onChange = vi.fn();
    render(<SortBar value="price" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bán chạy' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('best');
    fireEvent.click(screen.getByRole('button', { name: 'Giá, đổi chiều sắp xếp' }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('price');
  });

  it('tab đang chọn có gạch chân 2px và chữ màu thương hiệu; tab khác chữ phụ', () => {
    render(<SortBar value="best" options={OPTIONS} onChange={() => {}} />);
    const on = screen.getByRole('button', { name: 'Bán chạy' });
    const off = screen.getByRole('button', { name: 'Mới' });
    expect(on.style.boxShadow).toContain('var(--color-border-selected)');
    expect(on.style.boxShadow).toContain('2px');
    expect(on.style.color).toBe('var(--color-text-brand)');
    expect(off.style.boxShadow).toBe('');
    expect(off.style.color).toBe('var(--color-text-secondary)');
  });

  it('value ngoài options: không nút nào pressed, không lỗi', () => {
    render(<SortBar value="khong-co" options={OPTIONS} onChange={() => {}} />);
    for (const b of screen.getAllByRole('button')) expect(b).toHaveAttribute('aria-pressed', 'false');
  });

  it('filterCount=2 + onFilter: "Lọc (2)", tên đọc "Lọc, 2 bộ lọc đang bật", bấm gọi onFilter', () => {
    const onFilter = vi.fn();
    render(<SortBar value="best" options={OPTIONS} onChange={() => {}} filterCount={2} onFilter={onFilter} />);
    const btn = screen.getByRole('button', { name: 'Lọc, 2 bộ lọc đang bật' });
    expect(btn).toHaveTextContent('Lọc (2)');
    fireEvent.click(btn);
    expect(onFilter).toHaveBeenCalledTimes(1);
  });

  it.each([[0], [-1], [Number.NaN], [undefined]])('filterCount=%s: chữ "Lọc", không "(0)", không tên đọc đếm', (n) => {
    render(<SortBar value="best" options={OPTIONS} onChange={() => {}} filterCount={n} onFilter={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Lọc' });
    expect(btn).toHaveTextContent(/^Lọc$/);
    expect(btn.hasAttribute('aria-label')).toBe(false);
  });

  it('không onFilter thì không nút Lọc; options rỗng và không onFilter thì render rỗng', () => {
    const { container, rerender } = render(<SortBar value="best" options={OPTIONS} onChange={() => {}} filterCount={3} />);
    expect(screen.queryByRole('button', { name: /Lọc/ })).toBeNull();
    rerender(<SortBar value="" options={[]} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('options rỗng nhưng có onFilter: vẫn còn nút Lọc', () => {
    render(<SortBar value="" options={[]} onChange={() => {}} onFilter={() => {}} />);
    expect(screen.getByRole('button', { name: 'Lọc' })).toBeInTheDocument();
  });

  it('sticky: position sticky dưới header; không sticky thì không đặt position', () => {
    const { container, rerender } = render(<SortBar value="best" options={OPTIONS} onChange={() => {}} sticky />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.position).toBe('sticky');
    expect(root.style.top).toBe('var(--sort-bar-top, 0px)');
    rerender(<SortBar value="best" options={OPTIONS} onChange={() => {}} />);
    expect((container.firstElementChild as HTMLElement).style.position).toBe('');
  });

  it('mọi nút cao tối thiểu 44px', () => {
    render(<SortBar value="best" options={OPTIONS} onChange={() => {}} filterCount={1} onFilter={() => {}} />);
    for (const b of screen.getAllByRole('button')) expect(b.style.minHeight).toBe('44px');
  });

  it('hàng tab cuộn ngang có mờ mép; tab đang chọn nằm ngoài khung thì cuộn ngang hàng vào, không kéo trang', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 44, width: right - left, height: 44, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'group') return rect(0, 300);
      return this.getAttribute('aria-pressed') === 'true' ? rect(350, 420) : rect(0, 0);
    });
    const { rerender } = render(<SortBar value="best" options={OPTIONS} onChange={() => {}} filterCount={3} onFilter={() => {}} />);
    const group = screen.getByRole('group', { name: 'Sắp xếp' });
    expect(group.className).toContain('tubu-scroll-fade');
    expect(group.scrollLeft).toBe(120);
    spy.mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'group') return rect(0, 300);
      return this.getAttribute('aria-pressed') === 'true' ? rect(100, 160) : rect(0, 0);
    });
    group.scrollLeft = 0;
    rerender(<SortBar value="price" options={OPTIONS} onChange={() => {}} filterCount={3} onFilter={() => {}} />);
    expect(group.scrollLeft).toBe(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
    spy.mockRestore();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('options rỗng rồi có lại: không lỗi hook (hook đứng trước return sớm)', () => {
    const { rerender, container } = render(<SortBar value="" options={[]} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SortBar value="best" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole('group', { name: 'Sắp xếp' })).toBeInTheDocument();
  });
});
