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
  it('min touch height 36 visual / 44 hit area via padding', () => {
    render(<Chip>x</Chip>);
    expect(screen.getByRole('button').style.minHeight).toBe('36px');
  });
  it('fires onPress', () => {
    const onPress = vi.fn();
    render(<Chip onPress={onPress}>x</Chip>);
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('vùng chạm 44px (class tubu-hit-44) mà không đổi chiều cao nhìn thấy', () => {
    render(<Chip>x</Chip>);
    const chip = screen.getByRole('button');
    expect(chip.className).toContain('tubu-hit-44');
    expect(chip.style.minHeight).toBe('36px');
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
