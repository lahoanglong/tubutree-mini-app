// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { click, render } from '@/test-utils/dom';
import { Baby } from 'lucide-react';
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
});
