// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProductCategoriesTab } from './product-categories-tab';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, selectValue, type Rendered } from '@/test-utils/dom';
import type { CategoryProductsPage } from '@/lib/product-categories';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const PAGE: CategoryProductsPage = {
  items: [
    { id: 'p1', name: 'Nước rửa chén', thumbnail: null, brand: 'Tubu Tree', pancakeId: 'pk1', isActive: true, categoryIds: [] },
    { id: 'p2', name: 'Xà phòng', thumbnail: null, brand: 'Tubu Tree', pancakeId: 'pk2', isActive: true, categoryIds: ['c1'] },
  ],
  total: 2,
  nextCursor: null,
};

function setup() {
  const m = mockFetch({
    '/admin/product-categories/assign': { body: { requested: 2, changed: 1, unchanged: 1, category: { id: 'c2', name: 'Nhà bếp' } } },
    '/admin/product-categories/products': { body: PAGE },
    '/admin/pancake/categories': { body: [{ id: '865301', name: 'Bếp', path: 'Nhà > Bếp', mappedTo: 'c2' }] },
    '/categories': {
      body: [
        { id: 'c1', name: 'Giặt tẩy', slug: 'a', sortOrder: 1, productCount: 3 },
        { id: 'c2', name: 'Nhà bếp', slug: 'b', sortOrder: 2, productCount: 0 },
      ],
    },
  });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  const r = render(<ProductCategoriesTab />);
  mounted.push(r);
  return { m, container: r.container };
}

describe('ProductCategoriesTab (gán danh mục hàng loạt)', () => {
  it('mặc định lọc chưa có danh mục + hàng Pancake; hiện danh mục đã gán bằng tên', async () => {
    const { m, container } = setup();
    await flush();
    const list = m.calls.find((c) => c.url.includes('/admin/product-categories/products'))!;
    expect(list.url).toContain('uncategorized=1');
    expect(list.url).toContain('source=pancake');
    expect(container.textContent).toContain('Chưa có danh mục');
    expect(container.textContent).toContain('Giặt tẩy');
  });

  it('chọn tất cả → chọn danh mục → xác nhận → gửi đúng productIds, categoryId, mode', async () => {
    const { m, container } = setup();
    await flush();
    const buttons = () => Array.from(container.querySelectorAll('button'));
    expect(buttons().find((b) => b.textContent === 'Gán danh mục')!.disabled).toBe(true);
    click(container.querySelector('label input[type="checkbox"]'));
    selectValue(container.querySelector('select[aria-label="Danh mục"]'), 'c2');
    await flush();
    click(byText(container, 'button', 'Gán danh mục'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('Gán danh mục "Nhà bếp" cho 2 sản phẩm');
    answerConfirm(true);
    await flush();
    const call = m.calls.find((c) => c.url.includes('/assign'))!;
    expect(JSON.parse(String(call.init?.body))).toEqual({ productIds: ['p1', 'p2'], categoryId: 'c2', mode: 'ADD' });
    expect(container.textContent).toContain('1 sản phẩm đổi, 1 không đổi');
  });

  it('huỷ xác nhận thì không gọi API', async () => {
    const { m, container } = setup();
    await flush();
    click(container.querySelector('label input[type="checkbox"]'));
    selectValue(container.querySelector('select[aria-label="Danh mục"]'), 'c1');
    await flush();
    click(byText(container, 'button', 'Gỡ danh mục'));
    await flush();
    answerConfirm(false);
    await flush();
    expect(m.calls.some((c) => c.url.includes('/assign'))).toBe(false);
  });

  it('khung nhóm hàng Pancake chỉ tải khi mở, kèm danh mục đã ánh xạ', async () => {
    const { m, container } = setup();
    await flush();
    expect(m.calls.some((c) => c.url.includes('/admin/pancake/categories'))).toBe(false);
    click(byText(container, 'button', 'nhóm hàng Pancake'));
    await flush();
    expect(container.textContent).toContain('Nhà > Bếp');
    expect(container.textContent).toContain('→ Nhà bếp');
  });
});
