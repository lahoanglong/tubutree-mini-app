import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SearchField } from './search-field';

function renderField(over: Partial<Parameters<typeof SearchField>[0]> = {}) {
  const props = { value: '', onChange: vi.fn(), onSubmit: vi.fn(), label: 'Tìm sản phẩm', clearLabel: 'Xoá từ khoá', placeholder: 'Tìm sản phẩm...', ...over };
  render(<SearchField {...props} />);
  return props;
}

describe('SearchField', () => {
  it('vùng role=search, ô nhập có nhãn, bàn phím hiện nút "Tìm"', () => {
    renderField();
    expect(screen.getByRole('search')).toBeInTheDocument();
    const input = screen.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    expect(input).toHaveAttribute('enterkeyhint', 'search');
    expect(input).toHaveAttribute('placeholder', 'Tìm sản phẩm...');
  });

  it('gõ → onChange; Enter → onSubmit với giá trị hiện tại (không reload trang)', () => {
    const p = renderField({ value: 'nước' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nước rửa' } });
    expect(p.onChange).toHaveBeenCalledWith('nước rửa');
    fireEvent.submit(screen.getByRole('search'));
    expect(p.onSubmit).toHaveBeenCalledWith('nước');
  });

  it('phím Enter thật trong ô nhập gửi đúng một lần với giá trị hiện tại', async () => {
    const user = userEvent.setup();
    const p = renderField({ value: 'nước' });
    await user.click(screen.getByRole('searchbox'));
    await user.keyboard('{Enter}');
    expect(p.onSubmit).toHaveBeenCalledTimes(1);
    expect(p.onSubmit).toHaveBeenCalledWith('nước');
  });

  it('nút xoá chỉ hiện khi có chữ; mặc định onChange(""), có onClear thì gọi onClear', () => {
    const { rerender } = render(<SearchField value="" onChange={vi.fn()} onSubmit={vi.fn()} label="Tìm" clearLabel="Xoá từ khoá" placeholder="" />);
    expect(screen.queryByRole('button', { name: 'Xoá từ khoá' })).toBeNull();
    const onChange = vi.fn();
    const onClear = vi.fn();
    rerender(<SearchField value="abc" onChange={onChange} onSubmit={vi.fn()} label="Tìm" clearLabel="Xoá từ khoá" placeholder="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá từ khoá' }));
    expect(onChange).toHaveBeenCalledWith('');
    rerender(<SearchField value="abc" onChange={onChange} onClear={onClear} onSubmit={vi.fn()} label="Tìm" clearLabel="Xoá từ khoá" placeholder="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá từ khoá' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('bấm nút xoá không gửi form và có vùng chạm 44px', () => {
    const p = renderField({ value: 'abc' });
    const clear = screen.getByRole('button', { name: 'Xoá từ khoá' });
    expect(clear).toHaveAttribute('type', 'button');
    expect(clear.style.minWidth).toBe('44px');
    expect(clear.style.minHeight).toBe('44px');
    fireEvent.click(clear);
    expect(p.onSubmit).not.toHaveBeenCalled();
  });

  it('không tự focus khi mount; onFocus được gọi khi người dùng chạm vào ô', () => {
    const onFocus = vi.fn();
    renderField({ onFocus });
    const input = screen.getByRole('searchbox');
    expect(input).not.toHaveFocus();
    expect(onFocus).not.toHaveBeenCalled();
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('ô nhập khai báo inputMode="search" cho bàn phím di động', () => {
    renderField();
    expect(screen.getByRole('searchbox')).toHaveAttribute('inputmode', 'search');
  });

  it('ref trỏ tới <input> (trang Danh mục tự focus khi tới từ Trang chủ)', () => {
    const ref = createRef<HTMLInputElement>();
    render(<SearchField ref={ref} value="" onChange={vi.fn()} onSubmit={vi.fn()} label="Tìm" clearLabel="Xoá" placeholder="" />);
    ref.current!.focus();
    expect(document.activeElement).toBe(ref.current);
  });

  it('khung ô tìm cao ít nhất 44px', () => {
    renderField();
    expect((screen.getByTestId('search-field-box') as HTMLElement).style.minHeight).toBe('44px');
  });

  it('bấm nút xoá trả focus về ô nhập (bàn phím không bị đóng)', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    render(<SearchField ref={ref} value="abc" onChange={vi.fn()} onSubmit={vi.fn()} label="Tìm" clearLabel="Xoá từ khoá" placeholder="" />);
    await user.click(screen.getByRole('button', { name: 'Xoá từ khoá' }));
    expect(document.activeElement).toBe(ref.current);
  });

  it('nút xoá trả focus về ô nhập kể cả khi caller truyền onClear', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<SearchField value="abc" onChange={vi.fn()} onClear={onClear} onSubmit={vi.fn()} label="Tìm" clearLabel="Xoá từ khoá" placeholder="" />);
    await user.click(screen.getByRole('button', { name: 'Xoá từ khoá' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('khung có class cho vòng focus (:focus-within) và ô nhập tắt kiểu mặc định của WebKit', () => {
    renderField();
    expect(screen.getByTestId('search-field-box')).toHaveClass('tubu-search-field');
    expect((screen.getByRole('searchbox') as HTMLElement).style.getPropertyValue('-webkit-appearance')).toBe('none');
  });

  describe('gõ tiếng Việt bằng bộ gõ (IME)', () => {
    it('Enter đang trong lúc ghép chữ (isComposing) không gửi form', () => {
      renderField({ value: 'nuo' });
      const input = screen.getByRole('searchbox');
      expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false); // false = đã preventDefault → không gửi form ngầm
    });

    it('keyCode 229 (Safari bắn Enter sau compositionend) cũng không gửi', () => {
      renderField({ value: 'nuo' });
      expect(fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter', keyCode: 229 })).toBe(false);
    });

    it('Enter bình thường không bị chặn và gửi đúng một lần', async () => {
      const user = userEvent.setup();
      const p = renderField({ value: 'nước' });
      const input = screen.getByRole('searchbox');
      expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })).toBe(true);
      await user.click(input);
      await user.keyboard('{Enter}');
      expect(p.onSubmit).toHaveBeenCalledTimes(1);
    });

    it('phím khác khi đang ghép chữ không bị chặn', () => {
      renderField({ value: 'nuo' });
      expect(fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'a', isComposing: true })).toBe(true);
    });
  });
});
