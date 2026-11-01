// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CardVariant } from '@tubutree/app-core/commerce/product-card-view';
import { tileBodyHeight, TILE_METRICS } from '@tubutree/app-core/commerce/tile-metrics';
import { mount } from './harness';
import { ProductTileSkeleton } from './skeleton';

const body = (c: HTMLElement) => c.querySelector('[data-testid="catalog-tile-skeleton-body"]') as HTMLElement;

describe('ProductTileSkeleton (web): dựng từ cùng số đo với thẻ thật', () => {
  it.each(['grid', 'rail-sm', 'rail-md', 'flash', 'rank', 'line'] as CardVariant[])('%s: thân khung chờ cao đúng tileBodyHeight', (variant) => {
    const r = mount(<ProductTileSkeleton variant={variant} />);
    expect(body(r.container).style.height).toBe(`${tileBodyHeight(variant)}px`);
  });

  it('dải tên của khung chờ Giờ vàng một dòng như thẻ thật, rail-sm hai dòng', () => {
    const nameBar = (variant: CardVariant) => (mount(<ProductTileSkeleton variant={variant} />).container.querySelector('[data-testid="catalog-tile-skeleton-body"] .tubu-skeleton') as HTMLElement).style.height;
    expect(nameBar('flash')).toBe(`${TILE_METRICS.nameFlash}px`);
    expect(nameBar('rail-sm')).toBe(`${TILE_METRICS.nameCaption}px`);
  });
});
