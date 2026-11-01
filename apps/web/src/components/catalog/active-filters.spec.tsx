// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { ActiveFilters } from './active-filters';

let mounted: Rendered | null = null;
const mount = (props: Parameters<typeof ActiveFilters>[0]) => {
  mounted = render(<ActiveFilters {...props} />);
  return mounted.container;
};
const byLabel = (c: ParentNode, label: string) => c.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('ActiveFilters', () => {
  it('chip "Bỏ lọc X" gọi onPatch với patch của chip; nhóm "Đang lọc" có đệm dọc ≥ 4px', () => {
    const onPatch = vi.fn();
    const c = mount({
      filtersIgnored: false,
      onPatch,
      chips: [{ key: 'brand:Tubu', label: 'Tubu', patch: { brands: [] } }, { key: 'inStock', label: 'Còn hàng', patch: { inStock: false } }],
    });
    const group = c.querySelector<HTMLElement>('[role="group"][aria-label="Đang lọc"]')!;
    expect(parseFloat(group.style.paddingTop)).toBeGreaterThanOrEqual(4);
    expect(parseFloat(group.style.paddingBottom)).toBeGreaterThanOrEqual(4);
    expect(group.style.maxWidth).toBe('none');
    click(byLabel(c, 'Bỏ lọc Tubu'));
    expect(onPatch).toHaveBeenCalledWith({ brands: [] });
    click(byLabel(c, 'Bỏ lọc Còn hàng'));
    expect(onPatch).toHaveBeenLastCalledWith({ inStock: false });
  });

  it('không chip và không cờ: không vẽ gì (không để lại khoảng trống)', () => {
    const c = mount({ chips: [], filtersIgnored: false, onPatch: vi.fn() });
    expect(c.innerHTML).toBe('');
  });

  it('API cũ bỏ qua bộ lọc: câu báo nhẹ (role=status), không cần chip', () => {
    const c = mount({ chips: [], filtersIgnored: true, onPatch: vi.fn() });
    expect(c.querySelector('[role="status"]')!.textContent).toContain('Bộ lọc nâng cao chưa dùng được');
    expect(c.querySelector('[role="group"][aria-label="Đang lọc"]')).toBeNull();
  });
});
