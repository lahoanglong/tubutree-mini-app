import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Input } from './input';

describe('Input (ô nhập DS thay zmp-ui Input)', () => {
  it('nhãn gắn bằng label htmlFor: tìm được ô theo tên, chạm nhãn là vào ô', () => {
    render(<Input label="Số điện thoại" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Số điện thoại');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveClass('tubu-input');
    expect(input.closest('.tubu-input-group')?.querySelector('label')).toHaveAttribute('for', input.id);
  });

  it('không nhãn thì chỉ là một <input>, giữ id, aria-label và thuộc tính gốc của bên gọi', () => {
    const { container } = render(<Input id="q" aria-label="Mã" type="tel" inputMode="numeric" maxLength={10} placeholder="Nhập mã" inputClassName="tubu-nums" className="x" />);
    const input = screen.getByRole('textbox', { name: 'Mã' });
    expect(container.firstElementChild).toBe(input);
    expect(input).toHaveAttribute('id', 'q');
    expect(input).toHaveAttribute('type', 'tel');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('maxlength', '10');
    expect(input.className).toBe('tubu-input tubu-nums x');
  });

  it('status="error" thêm viền lỗi và aria-invalid; bên gọi tự đặt aria-invalid thì giữ của bên gọi', () => {
    const { rerender } = render(<Input aria-label="A" status="error" />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox')).toHaveClass('tubu-input--error');
    rerender(<Input aria-label="A" status="error" aria-invalid={false} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'false');
    rerender(<Input aria-label="A" />);
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('textbox')).not.toHaveClass('tubu-input--error');
  });

  it('ref trỏ vào <input>, onChange nhận sự kiện gốc', () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(<Input ref={ref} aria-label="A" onChange={onChange} />);
    expect(ref.current).toBe(screen.getByRole('textbox'));
    fireEvent.change(ref.current!, { target: { value: 'abc' } });
    expect(onChange.mock.calls[0]?.[0].target.value).toBe('abc');
  });

  it('Input.TextArea: <textarea> cùng viền, nhãn htmlFor, lỗi, ref', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Input.TextArea ref={ref} label="Ghi chú" status="error" rows={4} maxLength={200} />);
    const area = screen.getByLabelText('Ghi chú');
    expect(area.tagName).toBe('TEXTAREA');
    expect(ref.current).toBe(area);
    expect(area).toHaveClass('tubu-input', 'tubu-input--area', 'tubu-input--error');
    expect(area).toHaveAttribute('aria-invalid', 'true');
    expect(area).toHaveAttribute('maxlength', '200');
  });

  it('hai ô cùng nhãn có id riêng (useId), không trùng', () => {
    render(
      <>
        <Input label="Tên" />
        <Input label="Tên" />
      </>,
    );
    const [a, b] = screen.getAllByLabelText('Tên');
    expect(a?.id).toBeTruthy();
    expect(a?.id).not.toBe(b?.id);
  });
});

describe('kiểu .tubu-input trong tokens.css', () => {
  it('ô nhập cao 48px (vùng chạm ≥ 44), ô nhiều dòng cao tối thiểu 120px, chỉ dùng token màu', () => {
    const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
    const block = (sel: string) => new RegExp(`(^|\\n)${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`).exec(css)?.[2] ?? '';
    expect(block('.tubu-input')).toMatch(/\bheight: 48px;/);
    expect(block('.tubu-input--area')).toMatch(/min-height: 120px;/);
    expect(block('.tubu-input')).not.toMatch(/#[0-9a-f]{3,8}\b|var\(--(stone|forest|red)-/i);
  });
});
