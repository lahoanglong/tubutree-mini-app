import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Badge, StatusPill } from './badge';

describe('Badge', () => {
  it('success tone uses color.status.success tokens', () => {
    render(<Badge tone="success">Đã giao</Badge>);
    const el = screen.getByText('Đã giao');
    expect(el.style.background).toBe('var(--color-status-success-bg)');
    expect(el.style.color).toBe('var(--color-status-success-fg)');
  });
  it('promo tone uses color.promo tokens (replaces clay-* hardcoding)', () => {
    render(<Badge tone="promo">-20%</Badge>);
    const el = screen.getByText('-20%');
    expect(el.style.background).toBe('var(--color-promo-bg)');
  });
  it('StatusPill is the same component under a different name', () => {
    expect(StatusPill).toBe(Badge);
  });
});
