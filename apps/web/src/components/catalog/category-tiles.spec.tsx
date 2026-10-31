// @vitest-environment jsdom
import { LayoutGrid } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import type { CategoryEntry } from '@/lib/browse-categories';
import { CategoryTiles } from './category-tiles';

const entry = (i: number, image: string | null = null): CategoryEntry => ({ kind: 'category', key: `c${i}`, label: `Danh mục ${i}`, icon: LayoutGrid, image });
const many = (n: number) => Array.from({ length: n }, (_, i) => entry(i + 1));

let mounted: Rendered | null = null;
const mount = (props: Partial<Parameters<typeof CategoryTiles>[0]> = {}) => {
  const p = { entries: many(3), isLoading: false, placeholderCount: 4, onSelect: vi.fn(), onSelectAll: vi.fn(), ...props };
  mounted = render(<CategoryTiles {...p} />);
  return { c: mounted.container, ...p };
};
const names = (c: ParentNode) => [...c.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('CategoryTiles', () => {
  it('vùng "Danh mục" có tiêu đề h2; 10 danh mục chỉ hiện 8 ô + ô "Tất cả" ở cuối', () => {
    const { c } = mount({ entries: many(10) });
    const region = c.querySelector('section[aria-label="Danh mục"]')!;
    expect(region.querySelector('h2')!.textContent).toBe('Danh mục');
    expect(names(region)).toEqual([...many(8).map((e) => e.label), 'Tất cả']);
  });

  it('chạm ô gọi onSelect(mục); "Tất cả" gọi onSelectAll', () => {
    const entries = many(3);
    const { c, onSelect, onSelectAll } = mount({ entries });
    click(c.querySelector('button[aria-label="Danh mục 2"]'));
    expect(onSelect).toHaveBeenCalledWith(entries[1]);
    click(c.querySelector('button[aria-label="Tất cả"]'));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('danh sách rỗng vẫn có ô "Tất cả" (hub không bao giờ cụt)', () => {
    const { c } = mount({ entries: [] });
    expect(names(c)).toEqual(['Tất cả']);
  });

  it('đang tải: placeholderCount + 1 khung chờ ẩn khỏi trình đọc, không có nút', () => {
    const { c } = mount({ isLoading: true, placeholderCount: 6 });
    const loading = c.querySelector('[data-testid="category-grid-loading"]')!;
    expect(loading.getAttribute('aria-hidden')).toBe('true');
    expect(loading.children).toHaveLength(7);
    expect(c.querySelectorAll('button')).toHaveLength(0);
  });

  it('ô cao tối thiểu 88px (vùng chạm); ảnh danh mục thay icon và chỉ để trang trí', () => {
    const { c } = mount({ entries: [entry(1, 'https://img.test/a.jpg'), entry(2)] });
    for (const b of c.querySelectorAll<HTMLElement>('button')) expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(88);
    const imgs = c.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.getAttribute('src')).toBe('https://img.test/a.jpg');
    expect(imgs[0]!.getAttribute('alt')).toBe('');
  });

  it('nhãn tối đa hai dòng (line-clamp), không tràn ô', () => {
    const { c } = mount({ entries: [{ ...entry(1), label: 'Chăm sóc cá nhân và làm đẹp tự nhiên' }] });
    const label = c.querySelector<HTMLElement>('[data-tile-label]')!;
    expect(label.style.webkitLineClamp).toBe('2');
    expect(label.style.overflow).toBe('hidden');
  });

  it('lưới 4 cột ở điện thoại như Mini, rộng hơn khi màn rộng (một hàng ở lg)', () => {
    const { c } = mount();
    const grid = c.querySelector('button')!.parentElement!;
    expect(grid.className).toContain('grid-cols-4');
    expect(grid.className).toContain('lg:grid-cols-9');
  });
});
