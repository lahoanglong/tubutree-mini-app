// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveFilterChip } from '@/lib/search-state';
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

  it('chip là nút hành động gỡ lọc: không có aria-pressed, màu vẫn là màu chip đang chọn', () => {
    const c = mount({ filtersIgnored: false, onPatch: vi.fn(), chips: [{ key: 'inStock', label: 'Còn hàng', patch: { inStock: false } }] });
    const chip = byLabel(c, 'Bỏ lọc Còn hàng');
    expect(chip.hasAttribute('aria-pressed')).toBe(false);
    expect(chip.style.background).toContain('--color-action-primary-bg');
    expect(chip.style.color).toContain('--color-action-primary-fg');
    expect(chip.style.boxShadow).toBe('none');
  });

  it('chỉ có chip, không cờ: không vẽ vùng role=status trống', () => {
    const c = mount({ filtersIgnored: false, onPatch: vi.fn(), chips: [{ key: 'inStock', label: 'Còn hàng', patch: { inStock: false } }] });
    expect(c.querySelector('[role="status"]')).toBeNull();
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

    describe('đích focus khi hết chip + kẹp chỉ số', () => {
      const A: ActiveFilterChip = { key: 'a', label: 'A', patch: { inStock: false } };
      const B: ActiveFilterChip = { key: 'b', label: 'B', patch: { brands: [] } };
      const C: ActiveFilterChip = { key: 'c', label: 'C', patch: { minRating: undefined } };
      // onPatch gỡ đúng chip có patch đó (cùng tham chiếu), giống URL bỏ một bộ lọc.
      function TargetHarness({ initial, emptyFocusId }: { initial: ActiveFilterChip[]; emptyFocusId?: string }) {
        const [list, setList] = useState(initial);
        return (
          <>
            <h2 id="danh-sach-san-pham" tabIndex={-1}>Danh sách sản phẩm</h2>
            <h2 id="tieu-de-khac" tabIndex={-1}>Tiêu đề khác</h2>
            <ActiveFilters chips={list} filtersIgnored={false} emptyFocusId={emptyFocusId} onPatch={(p) => setList((l) => l.filter((x) => x.patch !== p))} />
          </>
        );
      }
      const mountTarget = (initial: ActiveFilterChip[], emptyFocusId?: string) => {
        mounted = render(<TargetHarness initial={initial} emptyFocusId={emptyFocusId} />);
        return mounted.container;
      };

      it('bàn phím: gỡ chip cuối cùng thì focus sang tiêu đề kết quả #danh-sach-san-pham', () => {
        withVisible(true);
        const c = mountTarget([A]);
        byLabel(c, 'Bỏ lọc A').focus();
        click(byLabel(c, 'Bỏ lọc A'));
        expect(c.querySelector('[role="group"][aria-label="Đang lọc"]')).toBeNull();
        expect(document.activeElement).toBe(document.getElementById('danh-sach-san-pham'));
      });

      it('emptyFocusId tuỳ chọn: chip cuối bị gỡ thì focus sang đúng phần tử đó', () => {
        withVisible(true);
        const c = mountTarget([A], 'tieu-de-khac');
        byLabel(c, 'Bỏ lọc A').focus();
        click(byLabel(c, 'Bỏ lọc A'));
        expect(document.activeElement).toBe(document.getElementById('tieu-de-khac'));
      });

      it('bàn phím: gỡ chip giữa thì focus sang chip đứng vào chỗ đó', () => {
        withVisible(true);
        const c = mountTarget([A, B, C]);
        byLabel(c, 'Bỏ lọc B').focus();
        click(byLabel(c, 'Bỏ lọc B'));
        expect(document.activeElement).toBe(byLabel(c, 'Bỏ lọc C'));
      });

      it('bàn phím: gỡ chip cuối khi còn chip khác thì focus về chip cuối mới (kẹp chỉ số)', () => {
        withVisible(true);
        const c = mountTarget([A, B]);
        byLabel(c, 'Bỏ lọc B').focus();
        click(byLabel(c, 'Bỏ lọc B'));
        expect(document.activeElement).toBe(byLabel(c, 'Bỏ lọc A'));
      });

      it('chuột/cảm ứng: gỡ chip cuối cùng cũng không đưa focus sang tiêu đề kết quả', () => {
        withVisible(false);
        const c = mountTarget([A]);
        byLabel(c, 'Bỏ lọc A').focus();
        click(byLabel(c, 'Bỏ lọc A'));
        expect(document.activeElement).toBe(document.body);
      });

      it('trình duyệt không hiểu :focus-visible (matches ném lỗi): vẫn gỡ chip, không đưa focus đi, không văng lỗi', () => {
        vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
          if (sel === ':focus-visible') throw new SyntaxError('unsupported pseudo-class');
          return realMatches.call(this, sel);
        });
        const c = mountTarget([A, B]);
        byLabel(c, 'Bỏ lọc A').focus();
        expect(() => click(byLabel(c, 'Bỏ lọc A'))).not.toThrow();
        expect(c.querySelector('button[aria-label="Bỏ lọc A"]')).toBeNull();
        expect(document.activeElement).toBe(document.body);
      });

      it('đã chuyển focus xong thì không còn "nợ": bộ chip đổi từ chỗ khác sau đó không giật focus về chip', () => {
        withVisible(true);
        function AddHarness() {
          const [list, setList] = useState<ActiveFilterChip[]>([A, B]);
          return (
            <>
              <button type="button" data-testid="add" onClick={() => setList((l) => [...l, C])}>thêm chip</button>
              <ActiveFilters chips={list} filtersIgnored={false} onPatch={(p) => setList((l) => l.filter((x) => x.patch !== p))} />
            </>
          );
        }
        mounted = render(<AddHarness />);
        const c = mounted.container;
        byLabel(c, 'Bỏ lọc A').focus();
        click(byLabel(c, 'Bỏ lọc A'));
        expect(document.activeElement).toBe(byLabel(c, 'Bỏ lọc B'));
        const add = c.querySelector<HTMLElement>('[data-testid="add"]')!;
        add.focus();
        click(add);
        expect(byLabel(c, 'Bỏ lọc C')).not.toBeNull();
        expect(document.activeElement).toBe(add);
      });

      it('bấm bàn phím rồi bấm chuột khi bộ chip chưa kịp đổi: lần chuột xoá vị trí cũ, bộ chip đổi sau đó không giật focus', () => {
        const visible = withVisible(true);
        function PendingHarness() {
          const [list, setList] = useState<ActiveFilterChip[]>([A, B]);
          return (
            <>
              <button type="button" data-testid="add" onClick={() => setList((l) => [...l, C])}>thêm chip</button>
              <ActiveFilters chips={list} filtersIgnored={false} onPatch={() => undefined} />
            </>
          );
        }
        mounted = render(<PendingHarness />);
        const c = mounted.container;
        byLabel(c, 'Bỏ lọc A').focus();
        click(byLabel(c, 'Bỏ lọc A'));
        visible.mockRestore();
        withVisible(false);
        byLabel(c, 'Bỏ lọc B').focus();
        click(byLabel(c, 'Bỏ lọc B'));
        const add = c.querySelector<HTMLElement>('[data-testid="add"]')!;
        add.focus();
        click(add);
        expect(byLabel(c, 'Bỏ lọc C')).not.toBeNull();
        expect(document.activeElement).toBe(add);
      });
    });
  });
});
