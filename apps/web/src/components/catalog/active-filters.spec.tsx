// @vitest-environment jsdom
import { useState } from 'react';
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
    expect(group.className).toContain('tubu-bleed');
    expect(group.className).not.toMatch(/-mx-/);
    expect(group.style.maxWidth).toBe('');
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

  describe('focus sau khi gỡ chip', () => {
    const chips = [{ key: 'a', label: 'A', patch: { inStock: false } }, { key: 'b', label: 'B', patch: { brands: [] } }];
    function Harness() {
      const [list, setList] = useState(chips);
      return <ActiveFilters chips={list} filtersIgnored={false} onPatch={() => setList((l) => l.slice(1))} />;
    }
    const mountHarness = () => {
      mounted = render(<Harness />);
      return mounted.container;
    };
    const realMatches = Element.prototype.matches;
    afterEach(() => vi.restoreAllMocks());
    const withVisible = (visible: boolean) =>
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
        return sel === ':focus-visible' ? visible && this === document.activeElement : realMatches.call(this, sel);
      });

    it('bàn phím (focus-visible): chip bị gỡ thì focus sang chip kế', () => {
      withVisible(true);
      const c = mountHarness();
      byLabel(c, 'Bỏ lọc A').focus();
      click(byLabel(c, 'Bỏ lọc A'));
      expect(document.activeElement).toBe(byLabel(c, 'Bỏ lọc B'));
    });

    it('chuột/cảm ứng (không focus-visible): không đưa focus đi đâu', () => {
      withVisible(false);
      const c = mountHarness();
      byLabel(c, 'Bỏ lọc A').focus();
      click(byLabel(c, 'Bỏ lọc A'));
      expect(document.activeElement).not.toBe(byLabel(c, 'Bỏ lọc B'));
    });
  });
});
