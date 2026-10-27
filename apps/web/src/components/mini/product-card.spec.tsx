// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mount } from './harness';

const mocks = vi.hoisted(() => ({ push: vi.fn(), flash: [] as unknown[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => mocks.flash }));

import ProductCard from './product-card';

const P = { id: 'p1', slug: 'gao', brand: 'Tubu', name: 'Gạo', thumbnail: null, basePrice: 100_000, salePrice: null, isFeatured: false, inStock: true };
const tap = (c: HTMLElement) => act(() => (c.querySelector('.tubu-tile-link') as HTMLElement).click());

describe('web ProductCard — liên kết tới trang chi tiết', () => {
  it('món gian hàng ghim phân loại: mở ?pv= của phân loại đó', () => {
    mocks.push.mockClear();
    mocks.flash = [];
    tap(mount(<ProductCard product={{ ...P, pinnedVariationId: 'v9' }} />).container);
    expect(mocks.push).toHaveBeenCalledWith('/san-pham/gao?pv=v9');
  });

  it('có Giờ vàng thắng thì ?v= của suất đó, vẫn ưu tiên hơn ghim; không gì cả thì đường dẫn trơn', () => {
    mocks.push.mockClear();
    mocks.flash = [{ itemId: 'f', variationId: 'v2', productSlug: 'gao', flashPrice: 80_000, retailPrice: 100_000, salePrice: null }];
    tap(mount(<ProductCard product={P} />).container);
    expect(mocks.push).toHaveBeenLastCalledWith('/san-pham/gao?v=v2');
    mocks.flash = [];
    tap(mount(<ProductCard product={P} />).container);
    expect(mocks.push).toHaveBeenLastCalledWith('/san-pham/gao');
  });
});
