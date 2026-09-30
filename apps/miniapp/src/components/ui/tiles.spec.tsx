import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatTile, FlashBadge, Avatar } from './tiles';

describe('small tiles', () => {
  it('StatTile shows label and value', () => {
    render(<StatTile label="Đơn tháng này" value="12" />);
    expect(screen.getByText('Đơn tháng này')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
  it('FlashBadge uses flash tone', () => {
    render(<FlashBadge label="Giờ vàng" />);
    expect(screen.getByText('Giờ vàng').style.background).toBe('var(--color-flash-solid-bg)');
  });
  it('Avatar falls back to initial when no src', () => {
    render(<Avatar fallback="Tubu" />);
    expect(screen.getByText('T')).toBeInTheDocument();
  });
});
