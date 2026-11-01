import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { styleOptions, type SectionStyle } from '@tubutree/app-core/commerce/storefront-builder';
import { LayoutPicker } from './layout-picker';

const open = styleOptions(null);
const radios = () => screen.getAllByRole('radio');

describe('LayoutPicker', () => {
  it('radiogroup có tên "Kiểu hiển thị"; 4 ô theo thứ tự Kệ ngang, Lưới, Danh sách, Combo', () => {
    render(<LayoutPicker value="GRID" onChange={() => undefined} options={open} />);
    expect(screen.getByRole('radiogroup', { name: 'Kiểu hiển thị' })).toBeInTheDocument();
    expect(radios().map((r) => r.textContent)).toEqual([expect.stringContaining('Kệ ngang'), expect.stringContaining('Lưới'), expect.stringContaining('Danh sách'), expect.stringContaining('Combo')]);
  });

  it('aria-checked theo value; chỉ ô đang chọn nằm trong thứ tự Tab', () => {
    render(<LayoutPicker value="STACK" onChange={() => undefined} options={open} />);
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false']);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, 0, -1]);
  });

  it('bấm ô khác gọi onChange với kiểu đó', () => {
    const onChange = vi.fn();
    render(<LayoutPicker value="GRID" onChange={onChange} options={open} />);
    fireEvent.click(screen.getByRole('radio', { name: /Danh sách/ }));
    expect(onChange).toHaveBeenCalledWith('STACK' satisfies SectionStyle);
  });

  it('ô khoá có aria-disabled, bấm không gọi onChange, trỏ tới lời giải thích', () => {
    const onChange = vi.fn();
    render(<LayoutPicker value="GRID" onChange={onChange} options={styleOptions({ kind: 'NORMAL' })} lockNote="Kiểu Combo chọn lúc tạo khối." />);
    const combo = screen.getByRole('radio', { name: /Combo/ });
    expect(combo).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(combo);
    expect(onChange).not.toHaveBeenCalled();
    const note = screen.getByText('Kiểu Combo chọn lúc tạo khối.');
    expect(combo.getAttribute('aria-describedby')).toBe(note.id);
  });

  it('phím mũi tên đổi ô, quay vòng và bỏ qua ô khoá', () => {
    const onChange = vi.fn();
    const { rerender } = render(<LayoutPicker value="STACK" onChange={onChange} options={styleOptions({ kind: 'NORMAL' })} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /Danh sách/ }), { key: 'ArrowRight' });
    // Combo khoá nên nhảy về Kệ ngang.
    expect(onChange).toHaveBeenLastCalledWith('CAROUSEL');
    rerender(<LayoutPicker value="CAROUSEL" onChange={onChange} options={open} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /Kệ ngang/ }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('COMBO');
  });

  it('mỗi ô cao ít nhất 44', () => {
    render(<LayoutPicker value="GRID" onChange={() => undefined} options={open} />);
    for (const r of radios()) expect(parseFloat(r.style.minHeight)).toBeGreaterThanOrEqual(44);
  });
});
