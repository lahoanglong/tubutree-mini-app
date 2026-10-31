// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { ListHeading } from './list-heading';

let mounted: Rendered | null = null;
const mount = (props: Parameters<typeof ListHeading>[0]) => {
  mounted?.unmount();
  mounted = render(<ListHeading {...props} />);
  return mounted.container;
};
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});
const count = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="result-count"]')!;

describe('ListHeading', () => {
  it('có tên danh mục: h2 một dòng + số sản phẩm (định dạng vi-VN)', () => {
    const c = mount({ title: 'Tẩy rửa sinh học', count: 1234, isLoading: false });
    expect(c.querySelector('h2')!.textContent).toBe('Tẩy rửa sinh học');
    expect(count(c).textContent).toBe('1.234 sản phẩm');
  });

  it('khi tìm kiếm (title=null) chỉ còn số, không có heading', () => {
    const c = mount({ title: null, count: 2, isLoading: false });
    expect(c.querySelector('h2, h3')).toBeNull();
    expect(count(c).textContent).toBe('2 sản phẩm');
  });

  it('số là vùng aria-live polite; đang tải hoặc chưa có số chỉ là khoảng trắng không ngắt (không in "0 sản phẩm")', () => {
    let c = mount({ title: 'A', count: 3, isLoading: true });
    expect(count(c).getAttribute('aria-live')).toBe('polite');
    expect(count(c).getAttribute('aria-atomic')).toBe('true');
    expect(count(c).textContent).toBe(' ');
    c = mount({ title: 'A', count: undefined, isLoading: false });
    expect(count(c).textContent).toBe(' ');
    c = mount({ title: 'A', count: 0, isLoading: false });
    expect(count(c).textContent).toBe('0 sản phẩm');
  });

  it('tiêu đề và số nằm CÙNG MỘT hàng (để thẻ đầu lên cao): số đẩy sang phải', () => {
    const c = mount({ title: 'Chăm sóc da', count: 12, isLoading: false });
    const row = c.querySelector('h2')!.parentElement as HTMLElement;
    expect(row.contains(count(c))).toBe(true);
    expect(row.style.display).toBe('flex');
    expect(count(c).style.marginLeft).toBe('auto');
  });

  it('tên dài không đẩy số ra ngoài khung: tiêu đề cắt một dòng', () => {
    const c = mount({ title: 'Rất dài '.repeat(20), count: 5, isLoading: false });
    const h = c.querySelector('h2')!;
    expect(h.style.whiteSpace).toBe('nowrap');
    expect(h.style.textOverflow).toBe('ellipsis');
  });
});
