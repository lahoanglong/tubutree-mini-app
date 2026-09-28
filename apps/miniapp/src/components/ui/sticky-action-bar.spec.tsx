import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StickyActionBar } from './sticky-action-bar';

describe('StickyActionBar', () => {
  it('applies safe-area padding exactly once and is fixed to the bottom', () => {
    render(<StickyActionBar primary={<button>Mua ngay</button>} />);
    const bar = screen.getByText('Mua ngay').closest('[data-testid="sticky-bar"]') as HTMLElement;
    expect(bar.style.position).toBe('fixed');
    expect(bar.style.paddingBottom).toBe('calc(16px + var(--safe-bottom))');
  });
  it('renders optional summary above the buttons', () => {
    render(<StickyActionBar primary={<button>x</button>} summary={<span>Tổng 100.000đ</span>} />);
    expect(screen.getByText('Tổng 100.000đ')).toBeInTheDocument();
  });
});
