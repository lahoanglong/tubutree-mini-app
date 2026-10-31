// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Baby, LayoutGrid } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import type { CategoryEntry } from '@/lib/browse-categories';

import { CategoryRow } from './category-row';

const entries = (n: number): CategoryEntry[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'category' as const, key: `c${i}`, label: `Danh mục ${i}`, icon: i % 2 ? Baby : LayoutGrid, image: null }));

let mounted: Rendered | null = null;
function mount(n: number, over: Partial<React.ComponentProps<typeof CategoryRow>> = {}) {
  const onSelect = vi.fn();
  const onSeeAll = vi.fn();
  mounted = render(<CategoryRow entries={entries(n)} isLoading={false} onSelect={onSelect} onSeeAll={onSeeAll} {...over} />);
  const c = mounted.container;
  const grid = c.querySelector<HTMLElement>('[role="region"][aria-label*="vuốt ngang"]')!;
  return { c, grid, onSelect, onSeeAll };
}
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('CategoryRow web — lưới 2 hàng × 5 cột như Mini (Q7)', () => {
  it('vùng tên "Danh mục" với tiêu đề h2 (SectionHeader); lưới xếp theo cột, 2 hàng, mỗi cột 1/5 bề rộng', () => {
    const { c, grid } = mount(6);
    const section = c.querySelector('section[aria-label="Danh mục"]')!;
    expect(section.querySelector('h2')?.textContent).toBe('Danh mục');
    expect(section.querySelector('[data-testid="section-header"]')).not.toBeNull();
    expect(grid.style.display).toBe('grid');
    expect(grid.style.gridAutoFlow).toBe('column');
    expect(grid.style.gridTemplateRows).toBe('repeat(2, auto)');
    expect(grid.style.gridAutoColumns).toBe('20%');
  });

  it('6 danh mục: 6 ô + "Tất cả" (ô thứ 7), tất cả nằm trong lưới', () => {
    const { grid } = mount(6);
    const buttons = Array.from(grid.querySelectorAll('button'));
    expect(buttons).toHaveLength(7);
    expect(buttons[6]!.getAttribute('aria-label')).toBe('Tất cả danh mục');
  });

  it('12 danh mục: đủ 12 ô + "Tất cả", cuộn ngang theo cột (không cắt bớt)', () => {
    const { grid } = mount(12);
    expect(grid.querySelectorAll('button')).toHaveLength(13);
  });

  it('chạm ô gọi onSelect đúng danh mục; chạm "Tất cả" gọi onSeeAll', () => {
    const { c, onSelect, onSeeAll } = mount(3);
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Danh mục 1') ?? null);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'c1' }));
    click(c.querySelector('button[aria-label="Tất cả danh mục"]'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('không truyền onSeeAll thì không có ô "Tất cả"', () => {
    const { c } = mount(3, { onSeeAll: undefined });
    expect(c.querySelector('button[aria-label="Tất cả danh mục"]')).toBeNull();
  });

  it('ảnh danh mục có thì vẽ ảnh, không có thì vẽ biểu tượng; ô nền màu xoay vòng', () => {
    const list: CategoryEntry[] = [
      { kind: 'category', key: 'a', label: 'Có ảnh', icon: LayoutGrid, image: 'https://img/a.png' },
      { kind: 'category', key: 'b', label: 'Không ảnh', icon: Baby, image: null },
    ];
    mounted = render(<CategoryRow entries={list} isLoading={false} onSelect={vi.fn()} />);
    const [withImg, noImg] = Array.from(mounted.container.querySelectorAll('button'));
    expect(withImg!.querySelector('img')?.getAttribute('src')).toBe('https://img/a.png');
    expect(noImg!.querySelector('svg')).not.toBeNull();
    const tiles = Array.from(mounted.container.querySelectorAll<HTMLElement>('[data-testid="category-tile"]'));
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.style.background).not.toBe(tiles[1]!.style.background);
  });

  it('mỗi ô cao tối thiểu 44px', () => {
    const { c } = mount(2);
    for (const b of Array.from(c.querySelectorAll('button'))) expect(b.style.minHeight).toBe('44px');
  });

  it('đang tải: khung chờ 10 ô mặc định; theo số ô nhớ thì ít hơn (cộng ô "Tất cả"), tối đa 10', () => {
    const count = (over: Partial<React.ComponentProps<typeof CategoryRow>>) => {
      const { c } = mount(0, { isLoading: true, entries: [], ...over });
      const n = c.querySelectorAll('[data-testid="category-row-skeleton"]').length;
      mounted!.unmount();
      mounted = null;
      return n;
    };
    expect(count({})).toBe(10);
    expect(count({ placeholderCount: 4 })).toBe(5);
    expect(count({ placeholderCount: 20 })).toBe(10);
  });

  it('không còn lề âm ở mọi khổ: không `margin: 0 -16px` inline, `-mx-4` chỉ đi kèm tiền tố max-md', () => {
    const src = readFileSync(join(__dirname, 'category-row.tsx'), 'utf8');
    expect(src).not.toMatch(/margin:\s*'0 -16px'/);
    expect(src.match(/(?<!max-md:)-mx-4/g) ?? []).toEqual([]);
  });

  it('hàng cuộn tràn mép chỉ dưới md (max-md:-mx-4) để cột thứ 6 thò ra mép như Mini; từ md nằm trong khung', () => {
    const { grid } = mount(6);
    expect(grid.className).toContain('max-md:-mx-4');
    expect(grid.className).toContain('max-md:px-4');
    expect(grid.className).toContain('max-md:max-w-none');
    expect(grid.style.marginLeft).toBe('');
    expect(grid.style.paddingLeft).toBe('');
  });
});
