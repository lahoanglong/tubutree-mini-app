// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { BrandGrid } from './brand-grid';

const brands = (n: number) => Array.from({ length: n }, (_, i) => ({ brand: `Nhãn ${String(i).padStart(2, '0')}`, count: i + 1 }));

let mounted: Rendered | null = null;
const mount = (list: Parameters<typeof BrandGrid>[0]['brands'], onSelect = vi.fn()) => {
  mounted = render(<BrandGrid brands={list} onSelect={onSelect} />);
  return { c: mounted.container, onSelect };
};
const names = (c: ParentNode) => [...c.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('BrandGrid', () => {
  it('5 nhãn: hiện đủ, tên đọc là "Xem thương hiệu X", chạm gọi onSelect(tên)', () => {
    const { c, onSelect } = mount(brands(5));
    const region = c.querySelector('section[aria-label="Thương hiệu"]')!;
    expect(region.querySelector('h2')!.textContent).toBe('Thương hiệu');
    expect(region.querySelectorAll('button')).toHaveLength(5);
    click(c.querySelector('button[aria-label="Xem thương hiệu Nhãn 03"]'));
    expect(onSelect).toHaveBeenCalledWith('Nhãn 03');
  });

  it('dưới 4 nhãn hoặc chưa có dữ liệu: không vẽ gì (không để tiêu đề trơ)', () => {
    expect(mount(brands(3)).c.innerHTML).toBe('');
    expect(mount([]).c.innerHTML).toBe('');
    expect(mount(undefined).c.innerHTML).toBe('');
  });

  it('20 nhãn: cắt còn 12, nhãn nhiều sản phẩm đứng trước', () => {
    const { c } = mount(brands(20));
    const n = names(c);
    expect(n).toHaveLength(12);
    expect(n[0]).toBe('Xem thương hiệu Nhãn 19');
    expect(n[11]).toBe('Xem thương hiệu Nhãn 08');
  });

  it('có logoUrl: ảnh trang trí (alt rỗng); không có: chữ cái đầu của tên', () => {
    const list = [{ brand: 'Tubu', count: 9, logoUrl: 'https://img.test/tubu.png' }, ...brands(3).map((b) => ({ ...b, logoUrl: null }))];
    const { c } = mount(list);
    const imgs = c.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.getAttribute('alt')).toBe('');
    expect(imgs[0]!.getAttribute('src')).toBe('https://img.test/tubu.png');
    expect(c.querySelectorAll('[data-testid="initials-avatar"]')).toHaveLength(3);
  });

  it('ô cao tối thiểu 44px; tên dài cắt một dòng', () => {
    const { c } = mount([{ brand: 'Một thương hiệu có cái tên rất là dài', count: 9 }, ...brands(3)]);
    for (const b of c.querySelectorAll<HTMLElement>('button')) expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(44);
    const label = c.querySelector<HTMLElement>('[data-brand-label]')!;
    expect(label.style.whiteSpace).toBe('nowrap');
    expect(label.style.textOverflow).toBe('ellipsis');
  });

  it('4 cột ở điện thoại như Mini, một hàng 12 ô ở lg', () => {
    const { c } = mount(brands(5));
    const grid = c.querySelector('button')!.parentElement!;
    expect(grid.className).toContain('grid-cols-4');
    expect(grid.className).toContain('lg:grid-cols-12');
  });
});
