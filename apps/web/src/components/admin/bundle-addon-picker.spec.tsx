// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { AddonVariationPicker } from './bundle-addon-picker';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const PRODUCTS = [
  {
    id: 'p1',
    name: 'Nước rửa bình sữa',
    slug: 'nuoc-rua-binh-sua',
    brand: 'Tubu',
    thumbnail: null,
    isActive: true,
    variations: [
      { id: 'v-s', name: 'Chai 500ml', sku: 'NBS-500', price: 50_000, stock: 5, isActive: true },
      { id: 'v-l', name: 'Can 5L', sku: 'NBS-5L', price: 500_000, stock: 5, isActive: true },
      { id: 'v-x', name: 'Bản cũ', sku: 'NBS-OLD', price: 40_000, stock: 5, isActive: false },
    ],
  },
];

describe('AddonVariationPicker: món mua kèm chọn theo đúng một phân loại', () => {
  it('mỗi phân loại đang bán một dòng (bỏ phân loại đã tắt); chọn dòng trả đủ sản phẩm, phân loại và giá bán của phân loại đó', async () => {
    const api = mockFetch({ '/admin/products/search': { body: PRODUCTS } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const onPick = vi.fn();
    mounted = render(<AddonVariationPicker onPick={onPick} debounceMs={0} />);
    const c = mounted.container;
    typeInto(c.querySelector('input[type="search"]'), 'nuoc');
    await flush();
    const options = Array.from(c.querySelectorAll<HTMLElement>('[role="option"]'));
    expect(options).toHaveLength(2);
    expect(c.textContent).not.toContain('Bản cũ');
    click(options[1]!);
    expect(onPick).toHaveBeenCalledWith({ productId: 'p1', productName: 'Nước rửa bình sữa', variationId: 'v-l', variationName: 'Can 5L', price: 500_000 });
  });
});
