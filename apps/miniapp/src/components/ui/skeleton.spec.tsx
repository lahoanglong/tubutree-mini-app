import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { tileBodyHeight, TILE_METRICS } from '@tubutree/app-core/commerce/tile-metrics';
import type { CardVariant } from '@tubutree/app-core/commerce/product-card-view';
import { Skeleton, ProductCardSkeleton, ProductTileSkeleton, LineItemSkeleton } from './skeleton';

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

describe('ProductTileSkeleton: dựng từ cùng số đo với thẻ thật (không nhảy khi tải xong)', () => {
  const VARIANTS: CardVariant[] = ['grid', 'rail-sm', 'rail-md', 'flash', 'rank', 'line'];

  it.each(VARIANTS)('%s: thân khung chờ cao đúng tileBodyHeight', (variant) => {
    const { container } = render(<ProductTileSkeleton variant={variant} />);
    const body = container.querySelector('[data-testid="catalog-tile-skeleton-body"]') as HTMLElement;
    expect(body.style.height).toBe(`${tileBodyHeight(variant)}px`);
  });

  it('grid bỏ dòng nhãn hiệu thì thấp hơn 16px, note và footer cộng vào', () => {
    const { container } = render(<ProductTileSkeleton variant="grid" brand={false} />);
    expect((container.querySelector('[data-testid="catalog-tile-skeleton-body"]') as HTMLElement).style.height).toBe(`${tileBodyHeight('grid', { brand: false })}px`);
    const flash = render(<ProductTileSkeleton variant="flash" note footerHeight={28} />);
    expect((flash.container.querySelector('[data-testid="catalog-tile-skeleton-body"]') as HTMLElement).style.height).toBe(`${tileBodyHeight('flash', { note: true, footer: 28 })}px`);
  });

  it('dải tên của khung chờ Giờ vàng một dòng như thẻ thật, rail-sm hai dòng', () => {
    const nameBar = (variant: CardVariant) => {
      const { container, unmount } = render(<ProductTileSkeleton variant={variant} />);
      const h = (container.querySelector('[data-testid="catalog-tile-skeleton-body"] .tubu-skeleton') as HTMLElement).style.height;
      unmount();
      return h;
    };
    expect(nameBar('flash')).toBe(`${TILE_METRICS.nameFlash}px`);
    expect(nameBar('rail-sm')).toBe(`${TILE_METRICS.nameCaption}px`);
  });

  it('ảnh giữ tỉ lệ 1:1 (trừ line), vỏ aria-hidden', () => {
    const { container } = render(<ProductTileSkeleton variant="grid" />);
    expect((container.firstElementChild as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    expect((container.querySelector('.tubu-skeleton') as HTMLElement).style.aspectRatio).toBe('1 / 1');
  });
});
