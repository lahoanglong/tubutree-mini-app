import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Skeleton, ProductCardSkeleton, LineItemSkeleton } from './skeleton';

/**
 * Regression test for Task 21's var-name codemod: Task 3's token file dropped the old
 * --radius-md / --radius-lg / --shadow-sm / --neutral-0 names in favour of
 * --radius-control / --radius-card / --elevation-1 / --color-bg-surface. This file asserts
 * skeleton.tsx now references the NEW names, not the stale ones.
 */
describe('Skeleton token names', () => {
  it('default Skeleton uses --radius-control, not the stale --radius-md', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('.tubu-skeleton') as HTMLElement;
    expect(el.style.borderRadius).toBe('var(--radius-control)');
  });

  it('ProductCardSkeleton uses --color-bg-surface / --radius-card / --elevation-1, not the stale names', () => {
    const { container } = render(<ProductCardSkeleton />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.background).toBe('var(--color-bg-surface)');
    expect(card.style.borderRadius).toBe('var(--radius-card)');
    expect(card.style.boxShadow).toBe('var(--elevation-1)');
  });

  it('LineItemSkeleton uses --color-bg-surface / --radius-card, not the stale names', () => {
    const { container } = render(<LineItemSkeleton />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.background).toBe('var(--color-bg-surface)');
    expect(row.style.borderRadius).toBe('var(--radius-card)');
  });
});
