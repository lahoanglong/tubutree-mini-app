import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuantitySelector } from './quantity-selector';

describe('QuantitySelector', () => {
  it('hai nút là <button type="button"> thật có tên: Giảm số lượng / Tăng số lượng', () => {
    render(<QuantitySelector value={2} max={5} onChange={() => {}} />);
    for (const name of ['Giảm số lượng', 'Tăng số lượng']) {
      const btn = screen.getByRole('button', { name });
      expect(btn.tagName).toBe('BUTTON');
      expect(btn).toHaveAttribute('type', 'button');
    }
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('bấm − / + gọi onChange(value ∓ 1)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantitySelector value={2} max={5} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Giảm số lượng' }));
    await user.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    expect(onChange).toHaveBeenNthCalledWith(1, 1);
    expect(onChange).toHaveBeenNthCalledWith(2, 3);
  });

  it('bàn phím: Tab tới nút, Enter / Space đổi số lượng', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantitySelector value={2} max={5} onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Giảm số lượng' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenNthCalledWith(1, 1);
    expect(onChange).toHaveBeenNthCalledWith(2, 3);
  });

  it('ở min: nút − aria-disabled và bấm không gọi onChange; ở max: nút + tương tự', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<QuantitySelector value={1} max={3} onChange={onChange} />);
    const minus = screen.getByRole('button', { name: 'Giảm số lượng' });
    expect(minus).toHaveAttribute('aria-disabled', 'true');
    await user.click(minus);
    expect(onChange).not.toHaveBeenCalled();
    rerender(<QuantitySelector value={3} max={3} onChange={onChange} />);
    const plus = screen.getByRole('button', { name: 'Tăng số lượng' });
    expect(plus).toHaveAttribute('aria-disabled', 'true');
    await user.click(plus);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('min tuỳ chỉnh (dealer min=0) được tôn trọng', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantitySelector value={1} min={0} max={9} size="sm" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Giảm số lượng' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('cả hai cỡ có vùng chạm 44x44: md vuông 44, sm nhìn 36 nhưng ::after 44x44 (C-021)', () => {
    const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
    const rule = /\.tubu-hit-44-square::after\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/width:\s*44px/);
    expect(rule![1]).toMatch(/height:\s*44px/);

    const { rerender } = render(<QuantitySelector value={2} max={5} size="sm" onChange={() => {}} />);
    for (const btn of screen.getAllByRole('button')) {
      expect(btn.className).toContain('tubu-hit-44-square');
      expect(btn.style.width).toBe('36px');
    }
    rerender(<QuantitySelector value={2} max={5} size="md" onChange={() => {}} />);
    for (const btn of screen.getAllByRole('button')) {
      expect(btn.className).toContain('tubu-hit-44-square');
      expect(btn.style.width).toBe('44px');
      expect(btn.style.height).toBe('44px');
    }
  });
});
