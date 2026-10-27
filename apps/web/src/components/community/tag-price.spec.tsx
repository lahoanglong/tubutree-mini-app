// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ flash: [] as unknown[] }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => mocks.flash }));

import { TagPrice } from './tag-price';

const PRODUCT = { slug: 'hat-dieu', basePrice: 180_000, salePrice: 159_000 };
let mounted: Rendered | null = null;
const text = () => {
  mounted = render(<TagPrice product={PRODUCT} className="x" />);
  return mounted.container.textContent;
};

beforeEach(() => {
  mocks.flash = [];
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('TagPrice', () => {
  it('không Giờ vàng: giá đang bán', () => {
    expect(text()).toBe('159.000đ');
  });

  it('đang Giờ vàng: giá khách trả như thẻ sản phẩm', () => {
    mocks.flash = [{ itemId: 'f1', variationId: 'v1', productSlug: 'hat-dieu', flashPrice: 119_000, retailPrice: 180_000, salePrice: 159_000, soldCount: 0, quota: 5, endAt: '2026-10-01T00:00:00.000Z' }];
    expect(text()).toBe('119.000đ');
  });
});
