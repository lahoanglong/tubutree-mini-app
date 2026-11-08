import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import type { ActiveFilterChip } from '../../utils/search-state';
import { ActiveFilters } from './active-filters';

describe('ActiveFilters', () => {
  it('chip "Bỏ lọc X" gọi onPatch với patch của chip; nhóm "Đang lọc" có đệm dọc ≥ 4px', () => {
    const onPatch = vi.fn();
    render(
      <ActiveFilters
        filtersIgnored={false}
        onPatch={onPatch}
        chips={[{ key: 'brand:Tubu', label: 'Tubu', patch: { brands: [] } }, { key: 'inStock', label: 'Còn hàng', patch: { inStock: false } }]}
      />,
    );
    const group = screen.getByRole('group', { name: 'Đang lọc' });
    expect(parseFloat(group.style.paddingTop)).toBeGreaterThanOrEqual(4);
    expect(parseFloat(group.style.paddingBottom)).toBeGreaterThanOrEqual(4);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Tubu' }));
    expect(onPatch).toHaveBeenCalledWith({ brands: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Còn hàng' }));
    expect(onPatch).toHaveBeenLastCalledWith({ inStock: false });
  });

  it('chip là nút hành động gỡ lọc: không có aria-pressed, màu vẫn là màu chip đang chọn', () => {
    render(<ActiveFilters filtersIgnored={false} onPatch={vi.fn()} chips={[{ key: 'inStock', label: 'Còn hàng', patch: { inStock: false } }]} />);
    const chip = screen.getByRole('button', { name: 'Bỏ lọc Còn hàng' });
    expect(chip).not.toHaveAttribute('aria-pressed');
    expect(chip.style.background).toContain('--color-action-primary-bg');
    expect(chip.style.color).toContain('--color-action-primary-fg');
    expect(chip.style.boxShadow).toBe('none');
  });

  it('không chip và không cờ: không vẽ gì (không để lại khoảng trống)', () => {
    const { container } = render(<ActiveFilters chips={[]} filtersIgnored={false} onPatch={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('API cũ bỏ qua bộ lọc: câu báo nhẹ nằm trong role=status, không cần chip', () => {
    render(<ActiveFilters chips={[]} filtersIgnored onPatch={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Bộ lọc nâng cao chưa dùng được/);
    expect(screen.queryByRole('group', { name: 'Đang lọc' })).toBeNull();
  });

  it('chỉ có chip, không cờ: không vẽ vùng role=status trống', () => {
    render(<ActiveFilters chips={[{ key: 'inStock', label: 'Còn hàng', patch: { inStock: false } }]} filtersIgnored={false} onPatch={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  describe('focus sau khi gỡ chip', () => {
    const A: ActiveFilterChip = { key: 'a', label: 'A', patch: { inStock: false } };
    const B: ActiveFilterChip = { key: 'b', label: 'B', patch: { brands: [] } };
    const C: ActiveFilterChip = { key: 'c', label: 'C', patch: { minRating: undefined } };
    // onPatch gỡ đúng chip có patch đó (cùng tham chiếu), giống URL bỏ một bộ lọc.
    function Harness({ initial, emptyFocusId }: { initial: ActiveFilterChip[]; emptyFocusId?: string }) {
      const [list, setList] = useState(initial);
      return (
        <>
          <h2 id="danh-sach-san-pham" tabIndex={-1}>Danh sách sản phẩm</h2>
          <h2 id="tieu-de-khac" tabIndex={-1}>Tiêu đề khác</h2>
          <ActiveFilters chips={list} filtersIgnored={false} emptyFocusId={emptyFocusId} onPatch={(p) => setList((l) => l.filter((c) => c.patch !== p))} />
        </>
      );
    }
    const chip = (label: string) => screen.getByRole('button', { name: `Bỏ lọc ${label}` });
    const realMatches = Element.prototype.matches;
    afterEach(() => vi.restoreAllMocks());
    const withVisible = (visible: boolean) =>
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
        return sel === ':focus-visible' ? visible && this === document.activeElement : realMatches.call(this, sel);
      });

    it('bàn phím (focus-visible): gỡ chip đầu thì focus sang chip kế cùng vị trí', () => {
      withVisible(true);
      render(<Harness initial={[A, B, C]} />);
      chip('A').focus();
      fireEvent.click(chip('A'));
      expect(document.activeElement).toBe(chip('B'));
    });

    it('bàn phím: gỡ chip giữa thì focus sang chip đứng vào chỗ đó', () => {
      withVisible(true);
      render(<Harness initial={[A, B, C]} />);
      chip('B').focus();
      fireEvent.click(chip('B'));
      expect(document.activeElement).toBe(chip('C'));
    });

    it('bàn phím: gỡ chip cuối khi còn chip khác thì focus về chip cuối mới (kẹp chỉ số)', () => {
      withVisible(true);
      render(<Harness initial={[A, B]} />);
      chip('B').focus();
      fireEvent.click(chip('B'));
      expect(document.activeElement).toBe(chip('A'));
    });

    it('bàn phím: gỡ chip cuối cùng thì focus sang tiêu đề kết quả #danh-sach-san-pham', () => {
      withVisible(true);
      render(<Harness initial={[A]} />);
      chip('A').focus();
      fireEvent.click(chip('A'));
      expect(screen.queryByRole('group', { name: 'Đang lọc' })).toBeNull();
      expect(document.activeElement).toBe(document.getElementById('danh-sach-san-pham'));
    });

    it('emptyFocusId tuỳ chọn: chip cuối bị gỡ thì focus sang đúng phần tử đó', () => {
      withVisible(true);
      render(<Harness initial={[A]} emptyFocusId="tieu-de-khac" />);
      chip('A').focus();
      fireEvent.click(chip('A'));
      expect(document.activeElement).toBe(document.getElementById('tieu-de-khac'));
    });

    it('chuột/cảm ứng (không focus-visible): không đưa focus đi đâu, kể cả khi hết chip', () => {
      withVisible(false);
      render(<Harness initial={[A, B]} />);
      chip('A').focus();
      fireEvent.click(chip('A'));
      expect(document.activeElement).toBe(document.body);
      chip('B').focus();
      fireEvent.click(chip('B'));
      expect(document.activeElement).toBe(document.body);
    });

    it('trình duyệt không hiểu :focus-visible (matches ném lỗi): vẫn gỡ chip, không đưa focus đi, không văng lỗi', () => {
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
        if (sel === ':focus-visible') throw new SyntaxError('unsupported pseudo-class');
        return realMatches.call(this, sel);
      });
      render(<Harness initial={[A, B]} />);
      chip('A').focus();
      expect(() => fireEvent.click(chip('A'))).not.toThrow();
      expect(screen.queryByRole('button', { name: 'Bỏ lọc A' })).toBeNull();
      expect(document.activeElement).toBe(document.body);
    });

    it('đã chuyển focus xong thì không còn "nợ": bộ chip đổi từ chỗ khác sau đó không giật focus về chip', () => {
      withVisible(true);
      function AddHarness() {
        const [list, setList] = useState<ActiveFilterChip[]>([A, B]);
        return (
          <>
            <button type="button" onClick={() => setList((l) => [...l, C])}>thêm chip</button>
            <ActiveFilters chips={list} filtersIgnored={false} onPatch={(p) => setList((l) => l.filter((c) => c.patch !== p))} />
          </>
        );
      }
      render(<AddHarness />);
      chip('A').focus();
      fireEvent.click(chip('A'));
      expect(document.activeElement).toBe(chip('B'));
      const add = screen.getByRole('button', { name: 'thêm chip' });
      add.focus();
      fireEvent.click(add);
      expect(screen.getByRole('button', { name: 'Bỏ lọc C' })).toBeInTheDocument();
      expect(document.activeElement).toBe(add);
    });

    it('bấm bàn phím rồi bấm chuột khi bộ chip chưa kịp đổi: lần chuột xoá vị trí cũ, bộ chip đổi sau đó không giật focus', () => {
      const visible = withVisible(true);
      function PendingHarness() {
        const [list, setList] = useState<ActiveFilterChip[]>([A, B]);
        return (
          <>
            <button type="button" onClick={() => setList((l) => [...l, C])}>thêm chip</button>
            <ActiveFilters chips={list} filtersIgnored={false} onPatch={() => undefined} />
          </>
        );
      }
      render(<PendingHarness />);
      chip('A').focus();
      fireEvent.click(chip('A'));
      visible.mockRestore();
      withVisible(false);
      chip('B').focus();
      fireEvent.click(chip('B'));
      const add = screen.getByRole('button', { name: 'thêm chip' });
      add.focus();
      fireEvent.click(add);
      expect(screen.getByRole('button', { name: 'Bỏ lọc C' })).toBeInTheDocument();
      expect(document.activeElement).toBe(add);
    });
  });
});
