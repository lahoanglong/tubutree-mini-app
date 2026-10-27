// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ flash: [] as unknown[] }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => mocks.flash }));

import { ProductLink } from './product-link';

const PRODUCT = { slug: 'hat-dieu', basePrice: 180_000, salePrice: 159_000 };
const item = (over: Record<string, unknown>) => ({
  itemId: 'f1', variationId: 'v2', productSlug: 'hat-dieu', flashPrice: 150_000, retailPrice: 300_000, salePrice: null,
  soldCount: 0, quota: 5, endAt: '2026-10-01T00:00:00.000Z', ...over,
});

let mounted: Rendered | null = null;
const hrefOf = () => {
  mounted = render(<ProductLink product={PRODUCT}>Hạt điều</ProductLink>);
  return mounted.container.querySelector('a')!.getAttribute('href');
};

beforeEach(() => {
  mocks.flash = [];
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('ProductLink', () => {
  it('không Giờ vàng: liên kết trần', () => {
    expect(hrefOf()).toBe('/san-pham/hat-dieu');
  });

  it('Giờ vàng ở phân loại khác rẻ hơn giá thẻ: gắn ?v= để mở đúng phân loại', () => {
    mocks.flash = [item({})];
    expect(hrefOf()).toBe('/san-pham/hat-dieu?v=v2');
  });

  it('Giờ vàng đắt hơn giá thẻ (200.000đ so với 159.000đ): liên kết trần, mở phân loại mặc định', () => {
    mocks.flash = [item({ flashPrice: 200_000 })];
    expect(hrefOf()).toBe('/san-pham/hat-dieu');
  });

  it('hết Giờ vàng: liên kết trần', () => {
    mocks.flash = [];
    expect(hrefOf()).toBe('/san-pham/hat-dieu');
  });
});
