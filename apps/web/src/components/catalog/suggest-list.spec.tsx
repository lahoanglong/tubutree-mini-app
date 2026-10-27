// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductSuggestion } from '@tubutree/app-core/api/catalog';
import { render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ flash: [] as unknown[] }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => mocks.flash }));

import { SuggestList } from './suggest-list';

const P: ProductSuggestion = { slug: 'hat-dieu', name: 'Hạt điều rang', thumbnail: null, basePrice: 180_000, salePrice: 159_000 };

let mounted: Rendered | null = null;
function mount() {
  mounted = render(
    <SuggestList
      draft="hạt"
      recent={[]}
      categories={[]}
      products={[P]}
      loading={false}
      onPickKeyword={vi.fn()}
      onPickCategory={vi.fn()}
      onPickProduct={vi.fn()}
      onClearRecent={vi.fn()}
    />,
  );
  return mounted.container;
}

beforeEach(() => {
  mocks.flash = [];
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('SuggestList: giá sản phẩm', () => {
  it('không Giờ vàng: giá đang bán', () => {
    expect(mount().textContent).toContain('159.000đ');
  });

  it('đang Giờ vàng: giá khách trả như thẻ sản phẩm', () => {
    mocks.flash = [{ itemId: 'f1', variationId: 'v1', productSlug: 'hat-dieu', flashPrice: 119_000, retailPrice: 180_000, salePrice: 159_000, soldCount: 0, quota: 5, endAt: '2099-01-01T00:00:00.000Z' }];
    const text = mount().textContent;
    expect(text).toContain('119.000đ');
    expect(text).not.toContain('159.000đ');
  });
});
