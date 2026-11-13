// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, render, type Rendered } from '@/test-utils/dom';
import { BrandGrid } from './brand-grid';

const brands = (n: number) => Array.from({ length: n }, (_, i) => ({ brand: `Nhãn ${String(i).padStart(2, '0')}`, count: i + 1 }));

let mounted: Rendered | null = null;
const mount = (list: Parameters<typeof BrandGrid>[0]['brands'], onSelect = vi.fn()) => {
  mounted = render(<BrandGrid brands={list} onSelect={onSelect} />);
  return { c: mounted.container, onSelect };
};
const names = (c: ParentNode) => [...c.querySelectorAll('a')].map((b) => b.getAttribute('aria-label'));
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('BrandGrid', () => {
  it('5 nhãn: hiện đủ, tên đọc là "X, xem thương hiệu", chạm gọi onSelect(tên)', () => {
    const { c, onSelect } = mount(brands(5));
    const region = c.querySelector('section[aria-label="Thương hiệu"]')!;
    expect(region.querySelector('h2')!.textContent).toBe('Thương hiệu');
    expect(region.querySelectorAll('a')).toHaveLength(5);
    click(c.querySelector('a[aria-label="Nhãn 03, xem thương hiệu"]'));
    expect(onSelect).toHaveBeenCalledWith('Nhãn 03');
  });

  it('mỗi ô là liên kết thật tới /san-pham?brand=… (crawler đi theo được); Ctrl/Cmd+nhấp không bị chặn để mở tab mới', () => {
    const { c, onSelect } = mount(brands(5));
    const link = c.querySelector<HTMLAnchorElement>('a[aria-label="Nhãn 03, xem thương hiệu"]')!;
    expect(link.getAttribute('href')).toBe('/san-pham?brand=Nh%C3%A3n+03');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('logo thương hiệu qua bộ đổi cỡ; bộ đổi cỡ lỗi thì lùi về ảnh gốc', () => {
    const orig = 'https://content.pancake.vn/2-26/logo.jpg';
    const { c } = mount([{ brand: 'A', count: 5, logoUrl: orig }, ...brands(4)]);
    const img = c.querySelector('img')!;
    expect(img.getAttribute('src')).toContain('/img?w=');
    act(() => { img.dispatchEvent(new Event('error')); });
    expect(img.getAttribute('src')).toBe(orig);
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
    expect(n[0]).toBe('Nhãn 19, xem thương hiệu');
    expect(n[11]).toBe('Nhãn 08, xem thương hiệu');
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
    for (const b of c.querySelectorAll<HTMLElement>('a')) expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(44);
    const label = c.querySelector<HTMLElement>('[data-brand-label]')!;
    expect(label.style.whiteSpace).toBe('nowrap');
    expect(label.style.textOverflow).toBe('ellipsis');
  });

  it('4 cột ở điện thoại như Mini, một hàng 12 ô ở lg', () => {
    const { c } = mount(brands(5));
    const grid = c.querySelector('a')!.parentElement!;
    expect(grid.className).toContain('grid-cols-4');
    expect(grid.className).toContain('lg:grid-cols-12');
  });
  it('API chỉ trả nhãn vỏ "Tubu Tree": hiện 8 nhãn hành trình, liên kết thật tới /san-pham?q=, không chặn chạm', () => {
    const { c, onSelect } = mount([{ brand: 'Tubu Tree', count: 111 }]);
    const links = [...c.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links).toHaveLength(8);
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual(['Fuwa3e', 'BH.Nong', 'Pơ Lang', 'Visante', 'Hector', 'Le Plateau', 'Cobote', 'Sokfarm'].map((n) => `${n}, xem thương hiệu`));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['Fuwa3e', 'BH.NONG', 'PƠ LANG', 'Visante', 'Hector', 'Le Plateau', 'Cobote', 'Sokfarm'].map((q) => `/san-pham?q=${encodeURIComponent(q).replace(/%20/g, '+')}`));
    expect(c.textContent).not.toContain('Tubu Tree');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    links[0]!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('API có nhãn thật cùng nhãn vỏ thì vẫn dùng danh sách API (không đổi sang nhãn hành trình)', () => {
    const { c } = mount([{ brand: 'Tubu Tree', count: 50 }, ...brands(4)]);
    expect(names(c)).toContain('Nhãn 03, xem thương hiệu');
    expect(names(c)).not.toContain('Fuwa3e, xem thương hiệu');
  });
});
