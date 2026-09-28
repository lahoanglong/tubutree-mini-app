import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Card } from './card';

describe('Card', () => {
  it('raised (default) has elevation-1 box-shadow and radius-card', () => {
    render(<Card>x</Card>);
    const el = screen.getByText('x').parentElement as HTMLElement;
    expect(el.style.boxShadow).toBe('var(--elevation-1)');
    expect(el.style.borderRadius).toBe('var(--radius-card)');
  });
  it('outline has a border, no shadow', () => {
    render(<Card variant="outline">x</Card>);
    const el = screen.getByText('x').parentElement as HTMLElement;
    expect(el.style.border).toContain('var(--color-border-subtle)');
    expect(el.style.boxShadow).toBe('');
  });
  it('onPress makes it a role=button and fires on click', () => {
    const onPress = vi.fn();
    render(<Card onPress={onPress}>x</Card>);
    const el = screen.getByRole('button');
    fireEvent.click(el);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
