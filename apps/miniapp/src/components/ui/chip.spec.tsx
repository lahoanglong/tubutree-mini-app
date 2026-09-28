import { render, screen, fireEvent } from '@testing-library/react';
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
});
