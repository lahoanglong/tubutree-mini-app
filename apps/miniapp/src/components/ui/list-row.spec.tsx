import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ListRow } from './list-row';

describe('ListRow', () => {
  it('the ENTIRE row (not just the text) is clickable — regression test for the old primitives.tsx bug', () => {
    const onPress = vi.fn();
    render(<ListRow icon={<span data-testid="icon" />} title="Cài đặt" onPress={onPress} />);
    const row = screen.getByRole('button', { name: /Cài đặt/ });
    // Click the icon area, NOT the title text — old ListRow only attached onClick to the title's
    // inner Box, so clicking anywhere else in the row (icon, padding, trailing chevron) did nothing.
    const icon = screen.getByTestId('icon');
    expect(row.contains(icon)).toBe(true);
    expect(icon).not.toBe(screen.getByText('Cài đặt'));
    fireEvent.click(icon);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('clicking empty row padding (not the icon or title) still fires onPress', () => {
    const onPress = vi.fn();
    render(<ListRow title="Cài đặt" onPress={onPress} />);
    // The row element itself, not any descendant — simulates a tap on the row's empty space.
    fireEvent.click(screen.getByRole('button', { name: /Cài đặt/ }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('trailing="chevron" renders a chevron icon', () => {
    render(<ListRow title="x" trailing="chevron" onPress={() => {}} />);
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('minHeight 44', () => {
    render(<ListRow title="x" onPress={() => {}} />);
    expect(screen.getByRole('button').style.minHeight).toBe('44px');
  });

  it('no onPress → not rendered as a button (no false affordance)', () => {
    render(<ListRow title="x" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('destructive → title uses danger tone', () => {
    render(<ListRow title="Xoá tài khoản" destructive onPress={() => {}} />);
    const title = screen.getByText('Xoá tài khoản');
    expect(title.style.color).toContain('--color-text-danger');
  });
});
