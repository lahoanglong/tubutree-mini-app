import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Chip } from './chip';

describe('Chip', () => {
  it('selected chip uses forest action bg, unselected uses stone-100', () => {
    const { rerender } = render(<Chip selected>Còn hàng</Chip>);
    expect(screen.getByText('Còn hàng').style.background).toBe('var(--color-action-primary-bg)');
    rerender(<Chip>Còn hàng</Chip>);
    expect(screen.getByText('Còn hàng').style.background).toBe('var(--stone-100)');
  });
  it('chip cỡ md cao tối thiểu 44px', () => {
    render(<Chip>x</Chip>);
    expect(screen.getByRole('button').style.minHeight).toBe('44px');
  });
  it('không co lại trong hàng cuộn ngang: flexShrink 0 để nhãn đủ chữ, hàng cuộn thay vì bóp chip còn 44px (R2-ENGAGE-5)', () => {
    render(<Chip>🌿 Mẹ và bé</Chip>);
    expect(screen.getByRole('button').style.flexShrink).toBe('0');
  });
  it('fires onPress', () => {
    const onPress = vi.fn();
    render(<Chip onPress={onPress}>x</Chip>);
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('cỡ md cao thật 44px, vẫn giữ class tubu-hit-44', () => {
    render(<Chip>x</Chip>);
    const chip = screen.getByRole('button');
    expect(chip.className).toContain('tubu-hit-44');
    expect(chip.style.minHeight).toBe('44px');
  });
  it('vùng chạm >= 44px cả hai chiều cho cả hai cỡ: cao nhờ ::after 44px, rộng nhờ minWidth 44', () => {
    const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
    expect(css).toMatch(/\.tubu-hit-44::after\s*\{[^}]*height:\s*44px/);
    for (const size of ['sm', 'md'] as const) {
      const { unmount } = render(<Chip size={size}>5</Chip>);
      const chip = screen.getByRole('button');
      expect(chip.className).toContain('tubu-hit-44');
      expect(chip.style.minWidth).toBe('44px');
      unmount();
    }
  });
  it('ariaLabel đặt tên truy cập riêng (vd "Bỏ lọc Tubu")', () => {
    render(<Chip ariaLabel="Bỏ lọc Tubu" selected>Tubu</Chip>);
    expect(screen.getByRole('button', { name: 'Bỏ lọc Tubu' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('dùng <button type="button"> thật: nằm trong thứ tự Tab', () => {
    render(<form><Chip>x</Chip></form>);
    const chip = screen.getByRole('button');
    expect(chip.tagName).toBe('BUTTON');
    expect(chip).toHaveAttribute('type', 'button');
    expect(chip.tabIndex).toBe(0);
  });
  it('thao tác được bằng bàn phím: Tab tới chip rồi Enter / Space đều gọi onPress', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<Chip onPress={onPress}>x</Chip>);
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onPress).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onPress).toHaveBeenCalledTimes(2);
  });
  it('chip nằm trong form không gửi form khi bấm', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Chip>x</Chip></form>);
    fireEvent.click(screen.getByRole('button'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('ariaLabel thay thế tên truy cập tính từ nội dung (kể cả khi có count)', () => {
    render(<Chip ariaLabel="Lọc Tubu" count={3}>Tubu</Chip>);
    expect(screen.getByRole('button', { name: 'Lọc Tubu' })).toBeInTheDocument();
  });
});
