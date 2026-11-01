// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { click, render } from '@/test-utils/dom';
import { Baby } from 'lucide-react';
import type { CategoryNode } from '@tubutree/app-core/browse/category-tree';
import type { CategoryEntry } from '@/lib/browse-categories';
import { EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { FilterSidebar } from './filter-sidebar';

const ENTRIES: CategoryEntry[] = [
  { kind: 'category', key: 'c-be', label: 'Cho bé', icon: Baby },
  { kind: 'segment', key: 'eco', label: 'Sống xanh', icon: Baby },
];

function setup(state = EMPTY_SEARCH_STATE) {
  const onPickCategory = vi.fn();
  const onClearCategory = vi.fn();
  const onPatch = vi.fn();
  const r = render(
    <FilterSidebar state={state} entries={ENTRIES} brands={[{ brand: 'Visante', count: 3 }]} onPickCategory={onPickCategory} onClearCategory={onClearCategory} onPatch={onPatch} />,
  );
  return { c: r.container, onPickCategory, onClearCategory, onPatch };
}

const byText = (c: HTMLElement, sel: string, text: string) => Array.from(c.querySelectorAll<HTMLElement>(sel)).find((e) => e.textContent?.includes(text))!;

describe('FilterSidebar (cột lọc từ lg)', () => {
  it('ẩn dưới lg bằng class (điện thoại dùng hộp thoại Bộ lọc), có tên vùng', () => {
    const { c } = setup();
    const aside = c.querySelector('aside')!;
    expect(aside.className).toMatch(/\bhidden\b/);
    expect(aside.className).toMatch(/\blg:block\b/);
    expect(aside.getAttribute('aria-label')).toBe('Bộ lọc');
  });

  it('danh mục dạng danh sách: chọn gọi onPickCategory, "Tất cả" gọi onClearCategory, mục đang chọn aria-pressed', () => {
    const { c, onPickCategory, onClearCategory } = setup({ ...EMPTY_SEARCH_STATE, category: 'c-be' });
    expect(byText(c, 'button', 'Cho bé').getAttribute('aria-pressed')).toBe('true');
    expect(byText(c, 'button', 'Sống xanh').getAttribute('aria-pressed')).toBe('false');
    click(byText(c, 'button', 'Sống xanh'));
    expect(onPickCategory).toHaveBeenCalledWith(ENTRIES[1]);
    click(byText(c, 'button', 'Tất cả sản phẩm'));
    expect(onClearCategory).toHaveBeenCalled();
  });

  it('giá, còn hàng, đánh giá, thương hiệu áp dụng ngay bằng đúng tham số lọc sẵn có', () => {
    const { c, onPatch } = setup();
    click(byText(c, 'label', 'Dưới').querySelector('input')!);
    expect(onPatch).toHaveBeenLastCalledWith({ minPrice: undefined, maxPrice: 100_000 });
    click(byText(c, 'label', 'còn hàng').querySelector('input')!);
    expect(onPatch).toHaveBeenLastCalledWith({ inStock: true });
    click(byText(c, 'label', '4★').querySelector('input')!);
    expect(onPatch).toHaveBeenLastCalledWith({ minRating: 4 });
    click(byText(c, 'label', 'Visante').querySelector('input')!);
    expect(onPatch).toHaveBeenLastCalledWith({ brands: ['Visante'] });
  });

  it('có bộ lọc đang bật thì hiện "Xoá bộ lọc" và xoá đủ bốn loại', () => {
    const { c, onPatch } = setup({ ...EMPTY_SEARCH_STATE, inStock: true });
    click(byText(c, 'button', 'Xoá bộ lọc'));
    expect(onPatch).toHaveBeenCalledWith({ brands: [], minPrice: undefined, maxPrice: undefined, inStock: false, minRating: undefined });
  });

  it('không dính, không giới hạn cao, không cuộn riêng (cột 200px của ListingLayout, trang cuộn chung)', () => {
    const { c } = setup();
    const aside = c.querySelector('aside')!;
    expect(aside.className).not.toMatch(/sticky|max-h-|overflow/);
    expect(c.innerHTML).not.toMatch(/overflow-y-auto|max-h-/);
  });
});

describe('FilterSidebar — cây danh mục và thương hiệu', () => {
  const node = (id: string, name: string, productCount: number, children: CategoryNode[] = [], parentId: string | null = null): CategoryNode =>
    ({ id, parentId, name, slug: id, image: null, productCount, children });
  const TREE = [
    node('c-da', 'Chăm sóc da', 6, [node('c-rua', 'Rửa mặt', 3, [], 'c-da'), node('c-nang', 'Chống nắng', 3, [], 'c-da'), node('c-het', 'Mặt nạ', 0, [], 'c-da')]),
    node('c-toc', 'Chăm sóc tóc', 4, [node('c-goi', 'Dầu gội', 4, [], 'c-toc')]),
  ];
  const ROOTS: CategoryEntry[] = TREE.map((n) => ({ kind: 'category', key: n.id, label: n.name, icon: Baby }));
  const mount = (state = EMPTY_SEARCH_STATE, brands: { brand: string; count: number }[] = []) => {
    const onPickCategory = vi.fn();
    const r = render(
      <FilterSidebar state={state} entries={ROOTS} tree={TREE} brands={brands} onPickCategory={onPickCategory} onClearCategory={vi.fn()} onPatch={vi.fn()} />,
    );
    return { c: r.container, onPickCategory };
  };
  const names = (c: HTMLElement) => [...c.querySelectorAll('[role="group"][aria-label="Danh mục"] button')].map((b) => b.textContent);

  it('chưa chọn danh mục: chỉ các danh mục gốc, không có con nào', () => {
    const { c } = mount();
    expect(names(c)).toEqual(['Tất cả sản phẩm', 'Chăm sóc da', 'Chăm sóc tóc']);
  });

  it('đang ở một danh mục con: hiện con của gốc đang chọn (bỏ con hết hàng), con đang chọn aria-pressed; gốc khác không mở', () => {
    const { c, onPickCategory } = mount({ ...EMPTY_SEARCH_STATE, category: 'c-nang' });
    expect(names(c)).toEqual(['Tất cả sản phẩm', 'Chăm sóc da', 'Rửa mặt', 'Chống nắng', 'Chăm sóc tóc']);
    expect(byText(c, 'button', 'Chống nắng').getAttribute('aria-pressed')).toBe('true');
    expect(byText(c, 'button', 'Chăm sóc da').getAttribute('aria-pressed')).toBe('false');
    click(byText(c, 'button', 'Rửa mặt'));
    expect(onPickCategory).toHaveBeenCalledWith(expect.objectContaining({ kind: 'category', key: 'c-rua', label: 'Rửa mặt' }));
  });

  it('đang ở gốc có con: con hiện ngay dưới gốc; con hết hàng đang được chọn vẫn hiện', () => {
    expect(names(mount({ ...EMPTY_SEARCH_STATE, category: 'c-da' }).c)).toEqual(['Tất cả sản phẩm', 'Chăm sóc da', 'Rửa mặt', 'Chống nắng', 'Chăm sóc tóc']);
    expect(names(mount({ ...EMPTY_SEARCH_STATE, category: 'c-het' }).c)).toContain('Mặt nạ');
  });

  const BRANDS = Array.from({ length: 9 }, (_, i) => ({ brand: `Nhãn ${i + 1}`, count: 9 - i }));
  const brandLabels = (c: HTMLElement) => [...c.querySelectorAll('[role="group"][aria-label="Thương hiệu"] label')].map((l) => l.textContent);

  it('thương hiệu: hiện 6, nút "Thêm" mở hết, "Thu gọn" gập lại; không có khung cuộn riêng', () => {
    const { c } = mount(EMPTY_SEARCH_STATE, BRANDS);
    expect(brandLabels(c)).toEqual(BRANDS.slice(0, 6).map((b) => b.brand));
    const more = byText(c, 'button', 'Thêm');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    click(more);
    expect(brandLabels(c)).toHaveLength(9);
    const less = byText(c, 'button', 'Thu gọn');
    expect(less.getAttribute('aria-expanded')).toBe('true');
    click(less);
    expect(brandLabels(c)).toHaveLength(6);
  });

  it('thương hiệu đang chọn luôn hiện kể cả khi nằm ngoài 6 nhãn đầu; không đủ 7 nhãn thì không có nút Thêm', () => {
    const { c } = mount({ ...EMPTY_SEARCH_STATE, brands: ['Nhãn 9'] }, BRANDS);
    expect(brandLabels(c)).toEqual([...BRANDS.slice(0, 6).map((b) => b.brand), 'Nhãn 9']);
    expect(mount(EMPTY_SEARCH_STATE, BRANDS.slice(0, 6)).c.textContent).not.toContain('Thêm');
  });
});
