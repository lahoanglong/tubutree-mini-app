import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Zap } from 'lucide-react';
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
  it('icon: vẽ icon nét cạnh chữ, ăn màu chữ của tông; không icon thì không đổi bố cục', () => {
    const { container, rerender } = render(<Badge tone="promo" icon={Zap}>Giờ vàng</Badge>);
    const el = screen.getByText('Giờ vàng');
    const svg = el.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.display).toBe('inline-flex');
    rerender(<Badge tone="promo">Giờ vàng</Badge>);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('Giờ vàng').style.display).toBe('');
  });
  it('StatusPill is the same component under a different name', () => {
    expect(StatusPill).toBe(Badge);
  });
});
