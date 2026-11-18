// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { join } from 'node:path';
import { Baby, LayoutGrid } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { CATEGORY_CELL_HEIGHT, CATEGORY_LABEL_HEIGHT, CATEGORY_TILE_GUTTER } from '@tubutree/app-core/home-layout';
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
  const grid = c.querySelector<HTMLElement>('[data-testid="category-grid"]')!;
  return { c, grid, onSelect, onSeeAll };
}
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

/** Tên danh mục thật dài hơn một cột (M3): cùng luật với bản Mini. */
const LONG_NAMES = ['Chăm sóc nhà cửa thiên nhiên', 'Nông sản & đặc sản', 'Thực phẩm hữu cơ'];
const named = (labels: string[]): CategoryEntry[] => labels.map((label, i) => ({ kind: 'category' as const, key: `n${i}`, label, icon: LayoutGrid, image: null }));
const labelOf = (c: HTMLElement, name: string) =>
  Array.from(c.querySelectorAll<HTMLElement>('button *')).find((e) => e.textContent === name && e.children.length === 0)!;

describe('CategoryRow web — nhãn hai dòng cho tên dài (M3)', () => {
  it('tên dài: nhãn căn giữa, tối đa hai dòng (clamp 2), không một dòng nowrap/ellipsis, cao đúng LABEL_HEIGHT, đủ chữ trong DOM', () => {
    const { c } = mount(0, { entries: named(LONG_NAMES) });
    for (const name of LONG_NAMES) {
      const label = labelOf(c, name);
      expect(label.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
      expect(label.style.whiteSpace).not.toBe('nowrap');
      expect(label.style.textOverflow).toBe('');
      expect(label.style.textAlign).toBe('center');
      expect(label.style.height).toBe(`${CATEGORY_LABEL_HEIGHT}px`);
    }
  });

  it('nhãn dùng token nhãn nhỏ 12px/600 (không còn caption 13px, không còn 16px viết tay)', () => {
    const { c } = mount(0, { entries: named(LONG_NAMES) });
    for (const name of LONG_NAMES) {
      const label = labelOf(c, name);
      expect(label.style.fontSize).toBe('var(--type-label-size)');
      expect(label.style.lineHeight).toBe('var(--type-label-lh)');
    }
  });

  it('hàng một dòng 5 cột 20%: nhãn đúng bề rộng ô, không lấn sang ô kề, không siết chữ', () => {
    const { c } = mount(0, { entries: named(LONG_NAMES) });
    const label = labelOf(c, LONG_NAMES[0]!);
    expect(label.style.width).toBe('100%');
    expect(label.style.marginLeft).toBe('0px');
    expect(label.style.marginRight).toBe('0px');
    expect(label.style.letterSpacing).toBe('');
  });

  it('nhiều danh mục (Trang chủ chỉ vẽ 4 ô): nhãn vẫn đúng bề rộng ô 20%, không đệm hai bên, không siết chữ (không còn chế độ cột hẹp 5,5)', () => {
    const { c } = mount(0, { entries: named([...LONG_NAMES, ...entries(9).map((e) => e.label)]) });
    const label = labelOf(c, LONG_NAMES[0]!);
    expect(label.style.letterSpacing).toBe('');
    expect(label.style.width).toBe('100%');
    expect(label.style.paddingLeft).toBe('');
    expect(label.style.paddingRight).toBe('');
    expect(label.style.marginLeft).toBe('0px');
    expect(label.style.marginRight).toBe('0px');
    expect(label.style.height).toBe(`${CATEGORY_LABEL_HEIGHT}px`);
  });

  it('tên một từ dài hơn cột ("Probiotics") và tên một từ ngắn ("Thú cưng"): cùng chiều cao vùng nhãn; từ quá cột mới ngắt giữa từ', () => {
    const { c } = mount(0, { entries: named(['Probiotics', 'Thú cưng']) });
    for (const name of ['Probiotics', 'Thú cưng']) {
      const label = labelOf(c, name);
      expect(label.style.height).toBe(`${CATEGORY_LABEL_HEIGHT}px`);
      expect(label.style.overflowWrap).toBe('anywhere');
    }
  });
});

describe('CategoryRow web — một hàng 5 ô: 4 danh mục + "Tất cả" như Mini', () => {
  it('vùng tên "Danh mục" với tiêu đề h2 (SectionHeader); 12 danh mục: lưới 5 cột 20% một hàng, không xếp theo cột, không cuộn ngang (không còn vùng "vuốt ngang")', () => {
    const { c, grid } = mount(12);
    const section = c.querySelector('section[aria-label="Danh mục"]')!;
    expect(section.querySelector('h2')?.textContent).toBe('Danh mục');
    expect(section.querySelector('[data-testid="section-header"]')).not.toBeNull();
    expect(grid.style.display).toBe('grid');
    expect(grid.style.gridTemplateColumns).toBe('repeat(5, 20%)');
    expect(grid.style.gridAutoFlow).toBe('');
    expect(grid.style.gridTemplateRows).toBe('');
    expect(section.querySelector('[role="region"][aria-label*="vuốt ngang"]')).toBeNull();
    expect(grid.className).not.toContain('scroll-x');
  });

  it('12 danh mục: tiêu đề không có "Xem tất cả Danh mục" (ô "Tất cả" cuối hàng đã làm việc đó); chạm ô "Tất cả" gọi onSeeAll đúng một lần', () => {
    const { c, onSeeAll } = mount(12);
    expect(c.querySelector('[data-testid="section-header"] button')).toBeNull();
    click(c.querySelector('button[aria-label="Tất cả danh mục"]'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('mọi số danh mục (kể cả không có onSeeAll): tiêu đề không có nút "Xem tất cả"', () => {
    for (const [n, over] of [[3, {}], [9, {}], [12, { onSeeAll: undefined }]] as const) {
      const { c } = mount(n, over);
      expect(c.querySelector('[data-testid="section-header"] button')).toBeNull();
      mounted?.unmount();
    }
  });

  it('web: không có nút ‹ › cuộn ở hàng danh mục (hàng không cuộn), kể cả khi nhiều danh mục', () => {
    const proto = HTMLElement.prototype;
    const orig = { sw: Object.getOwnPropertyDescriptor(proto, 'scrollWidth'), cw: Object.getOwnPropertyDescriptor(proto, 'clientWidth') };
    Object.defineProperty(proto, 'scrollWidth', { configurable: true, get: () => 1000 });
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 400 });
    try {
      const next = 'button[aria-label="Xem các mục tiếp"]';
      expect(mount(12).c.querySelector(next)).toBeNull();
      mounted?.unmount();
      expect(mount(6).c.querySelector(next)).toBeNull();
    } finally {
      if (orig.sw) Object.defineProperty(proto, 'scrollWidth', orig.sw);
      if (orig.cw) Object.defineProperty(proto, 'clientWidth', orig.cw);
      else delete (proto as unknown as Record<string, unknown>).clientWidth;
    }
  });

  it('mọi số danh mục: xếp theo hàng, 5 cột 1/5 bề rộng, không xếp theo cột', () => {
    for (const n of [2, 3, 4, 6, 9, 12]) {
      const { grid } = mount(n);
      expect(grid.style.display).toBe('grid');
      expect(grid.style.gridTemplateColumns).toBe('repeat(5, 20%)');
      expect(grid.style.gridAutoFlow).toBe('');
      expect(grid.style.gridTemplateRows).toBe('');
      mounted?.unmount();
    }
  });

  it('2 danh mục: thứ tự DOM là hai danh mục rồi "Tất cả" ở cuối (cùng hàng, không chen giữa)', () => {
    const { grid } = mount(2);
    const labels = Array.from(grid.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(labels).toEqual(['Danh mục 0', 'Danh mục 1', 'Tất cả danh mục']);
  });

  it('9 hay 10 danh mục: vẫn một hàng 5 ô, không xếp theo cột', () => {
    for (const n of [9, 10]) {
      const { grid } = mount(n);
      expect(grid.style.gridAutoFlow).toBe('');
      expect(grid.querySelectorAll('button')).toHaveLength(5);
      mounted?.unmount();
    }
  });

  it('6 danh mục: chỉ 4 danh mục đầu + "Tất cả" (ô thứ 5); danh mục thứ 5 trở đi không vẽ (có ở trang Danh mục)', () => {
    const { grid } = mount(6);
    const buttons = Array.from(grid.querySelectorAll('button'));
    expect(buttons).toHaveLength(5);
    expect(buttons.slice(0, 4).map((b) => b.textContent)).toEqual(['Danh mục 0', 'Danh mục 1', 'Danh mục 2', 'Danh mục 3']);
    expect(buttons[4]!.getAttribute('aria-label')).toBe('Tất cả danh mục');
  });

  it('10 danh mục thật: Trang chủ chỉ vẽ 4 ô + "Tất cả", theo đúng thứ tự `entries`', () => {
    const { grid } = mount(10);
    const labels = Array.from(grid.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(labels).toEqual(['Danh mục 0', 'Danh mục 1', 'Danh mục 2', 'Danh mục 3', 'Tất cả danh mục']);
  });

  it('không có onSeeAll thì không có ô "Tất cả", hàng vẫn tối đa 5 ô', () => {
    const { c, grid } = mount(12, { onSeeAll: undefined });
    expect(c.querySelector('button[aria-label="Tất cả danh mục"]')).toBeNull();
    expect(grid.querySelectorAll('button')).toHaveLength(5);
  });

  it('chạm ô gọi onSelect đúng danh mục; chạm "Tất cả" gọi onSeeAll', () => {
    const { c, onSelect, onSeeAll } = mount(3);
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Danh mục 1') ?? null);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'c1' }));
    click(c.querySelector('button[aria-label="Tất cả danh mục"]'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('ảnh danh mục đi qua bộ đổi cỡ; bộ đổi cỡ lỗi thì lùi về ảnh gốc một lần', () => {
    const orig = 'https://content.pancake.vn/2-26/c.jpg';
    mounted = render(<CategoryRow entries={[{ kind: 'category', key: 'a', label: 'Có ảnh', icon: LayoutGrid, image: orig }]} isLoading={false} onSelect={vi.fn()} />);
    const img = mounted.container.querySelector('img')!;
    expect(img.getAttribute('src')).toContain('/img?w=');
    act(() => { img.dispatchEvent(new Event('error')); });
    expect(img.getAttribute('src')).toBe(orig);
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

  it('ô không đệm ngang để nhãn dùng đủ cột 20%, nhãn chữ nhỏ tối đa hai dòng, cao đúng LABEL_HEIGHT (H3 #5)', () => {
    const { c } = mount(12);
    const cell = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Danh mục 0')!;
    expect(cell.style.paddingLeft).toBe('0px');
    expect(cell.style.paddingRight).toBe('0px');
    const label = Array.from(cell.querySelectorAll<HTMLElement>('*')).find((e) => e.textContent === 'Danh mục 0' && e.children.length === 0)!;
    expect(label.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    expect(label.style.height).toBe(`${CATEGORY_LABEL_HEIGHT}px`);
  });

  it('nhãn không siết chữ ở mọi số danh mục: cột luôn 20% (không còn cột cuộn 5,5 hẹp ~62px)', () => {
    const labelOf = (c: HTMLElement) =>
      Array.from(c.querySelectorAll<HTMLElement>('button *')).find((e) => e.textContent === 'Danh mục 0' && e.children.length === 0)!;
    expect(labelOf(mount(12).c).style.letterSpacing).toBe('');
    mounted!.unmount();
    expect(labelOf(mount(6).c).style.letterSpacing).toBe('');
  });

  it('đang tải: khung chờ 5 ô mặc định (một hàng); theo số ô nhớ thì ít hơn (cộng ô "Tất cả"), tối đa 5', () => {
    const count = (over: Partial<React.ComponentProps<typeof CategoryRow>>) => {
      const { c } = mount(0, { isLoading: true, entries: [], ...over });
      const n = c.querySelectorAll('[data-testid="category-row-skeleton"]').length;
      mounted!.unmount();
      mounted = null;
      return n;
    };
    expect(count({})).toBe(5);
    expect(count({ placeholderCount: 2 })).toBe(3);
    expect(count({ placeholderCount: 4 })).toBe(5);
    expect(count({ placeholderCount: 20 })).toBe(5);
  });

  it('khung chờ và lưới thật dùng cùng một lưới (5 cột 20%, cùng lớp tràn mép và đệm): chiều cao khối bằng nhau nên trang không nhảy khi danh mục về', () => {
    const { grid: loading } = mount(0, { isLoading: true, entries: [] });
    const skeleton = { template: loading.style.gridTemplateColumns, padding: loading.style.paddingBlock, cls: loading.className };
    mounted?.unmount();
    const { grid: real } = mount(12);
    expect({ template: real.style.gridTemplateColumns, padding: real.style.paddingBlock, cls: real.className }).toEqual(skeleton);
  });

  it('ô khung chờ cao đúng ô thật (ô 56 + cách 4 + nhãn 32 = 92): khối phía dưới không nhảy khi danh mục về', () => {
    const { c } = mount(0, { isLoading: true, entries: [], placeholderCount: 4 });
    const cell = c.querySelector<HTMLElement>('[data-testid="category-row-skeleton"]')!;
    expect(cell.style.gap).toBe('4px');
    const [tile, labelSlot] = Array.from(cell.children) as HTMLElement[];
    expect(tile!.style.height).toBe('56px');
    expect(labelSlot!.style.height).toBe(`${CATEGORY_LABEL_HEIGHT}px`);
    expect(CATEGORY_CELL_HEIGHT).toBe(56 + 4 + CATEGORY_LABEL_HEIGHT);
  });

  it('không còn lề âm tay: không `margin: 0 -16px` inline, không `-mx-` (tràn mép do lớp .tubu-bleed)', () => {
    const src = readFileSync(join(__dirname, 'category-row.tsx'), 'utf8');
    expect(src).not.toMatch(/margin:\s*'0 -16px'/);
    expect(src).not.toMatch(/-mx-/);
  });

  it('hàng tràn mép chỉ dưới md (.tubu-bleed + max-md:px-4) như Mini; từ md nằm trong khung', () => {
    const { grid } = mount(6);
    expect(grid.className).toContain('tubu-bleed');
    expect(grid.className).toContain('max-md:px-4');
    expect(grid.className).not.toMatch(/-mx-|max-w-none/);
    expect(grid.style.marginLeft).toBe('');
    expect(grid.style.paddingLeft).toBe('');
  });
});

describe('CategoryRow web — từ md là hàng 5 thẻ ngang (W134)', () => {
  it('lưới một hàng: từ md 5 cột bằng nhau cách đều (ghi đè inline 20%), điện thoại giữ số đo Mini', () => {
    const { grid } = mount(5);
    expect(grid.className).toContain('lg:!grid-cols-5');
    expect(grid.className).toContain('lg:!gap-x-3');
    expect(grid.style.gridTemplateColumns).toBe('repeat(5, 20%)');
    expect(grid.className).toContain('max-md:px-4');
  });

  it('mỗi ô từ md là thẻ ngang nền sáng viền nhẹ cao bằng ô điện thoại; nhãn căn trái', () => {
    const { c } = mount(3);
    const cell = Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Danh mục 0')!;
    for (const cls of ['lg:!flex-row', 'lg:!rounded-card', 'lg:!border', 'lg:!min-h-[5.75rem]', 'lg:!text-left']) expect(cell.className).toContain(cls);
    expect(cell.style.flexDirection).toBe('column');
    const label = labelOf(c, 'Danh mục 0');
    expect(label.className).toContain('lg:!flex-1');
    expect(label.className).toContain('lg:!text-left');
  });

  it('ô "Tất cả" cùng kiểu nhãn với ô danh mục từ lg (căn trái, giãn hết thẻ): không lệch hàng chữ với bốn ô bên cạnh', () => {
    const { c } = mount(12);
    const all = labelOf(c, 'Tất cả');
    const cat = labelOf(c, 'Danh mục 0');
    expect(all.className).toBe(cat.className);
    expect(all.className).toContain('lg:!flex-1');
  });

  it('nhiều danh mục (12): vẫn một hàng 5 thẻ ngang từ md, không có lưới cột cuộn', () => {
    const { c, grid } = mount(12);
    expect(grid.className).toContain('lg:!grid-cols-5');
    expect(grid.style.gridAutoFlow).toBe('');
    const cell = Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Danh mục 0')!;
    expect(cell.className).toContain('lg:!flex-row');
  });

  it('ô vuông co ở khổ rất hẹp để chừa khe với ô kề (CATEGORY_TILE_GUTTER mỗi bên), từ 375px vẫn 56px', () => {
    const { c } = mount(3);
    const tile = c.querySelector<HTMLElement>('[data-testid="category-tile"]')!;
    expect(tile.style.width).toBe('56px');
    expect(tile.style.maxWidth).toBe(`calc(100% - ${CATEGORY_TILE_GUTTER * 2}px)`);
    expect(tile.style.aspectRatio).toBe('1 / 1');
  });
});
