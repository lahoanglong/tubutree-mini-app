// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProductCategoriesTab } from './product-categories-tab';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
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

  // D7-27: hai truy vấn cùng hỏng thì cùng một lời báo hiện hai lần (khung đỏ và dòng "Thử lại").
  it('D7-27: cả danh sách lẫn danh mục cùng lỗi một câu → chỉ hiện câu đó một lần, kèm "Thử lại"', async () => {
    const m = mockFetch({
      '/admin/product-categories/products': { status: 503, body: { message: 'Máy chủ đang bận, vui lòng thử lại sau.' } },
      '/admin/pancake/categories': { body: [] },
      '/categories': { status: 503, body: { message: 'Máy chủ đang bận, vui lòng thử lại sau.' } },
    });
    vi.stubGlobal('fetch', vi.fn(m.fn));
    const r = render(<ProductCategoriesTab />);
    mounted.push(r);
    await flush();
    const text = r.container.textContent ?? '';
    expect(text.split('Máy chủ đang bận, vui lòng thử lại sau.').length - 1).toBe(1);
    expect(byText(r.container, 'button', 'Thử lại')).not.toBeNull();
  });
  describe('sửa sản phẩm', () => {
    const DETAIL = {
      id: 'p1', name: 'Nước rửa chén', brand: 'Tubu Tree', description: 'Mô tả cũ', shortDesc: null, images: [], isActive: true, isFeatured: false,
      categoryIds: [], basePrice: 50000, salePrice: null, managedByPancake: true, partnerOwned: false, cannotShowReason: null,
    };
    function editSetup(detail: object = DETAIL) {
      const m = mockFetch({
        '/admin/catalog-products/': (init) => ({ body: init?.method === 'PATCH' ? { ...detail, ...JSON.parse(String(init.body)) } : detail }),
        '/admin/product-categories/products': { body: PAGE },
        '/categories': { body: [{ id: 'c1', name: 'Giặt tẩy', slug: 'a', sortOrder: 1, productCount: 3 }] },
      });
      vi.stubGlobal('fetch', vi.fn(m.fn));
      const r = render(<ProductCategoriesTab />);
      mounted.push(r);
      return { m, container: r.container };
    }

    it('chip "Đang bán, thiếu ảnh" gửi missingImage=1', async () => {
      const { m, container } = editSetup();
      await flush();
      click(byText(container, 'button', 'Đang bán, thiếu ảnh'));
      await flush();
      expect(m.calls.some((c) => c.url.includes('missingImage=1'))).toBe(true);
    });

    it('bấm Sửa → hiện tên, giá chỉ đọc và lý do; lưu gửi ảnh, mô tả, danh mục', async () => {
      const { m, container } = editSetup();
      await flush();
      click(container.querySelector('button[aria-label="Sửa Nước rửa chén"]'));
      await flush();
      const body = document.body;
      expect(body.textContent).toContain('Tên và giá lấy từ Pancake');
      expect(body.querySelector('input[aria-label="Tên"]')).toBeNull();
      click(byText(body, 'button', 'Thêm ảnh'));
      await flush();
      typeInto(body.querySelector('input[aria-label="Link ảnh ảnh 1"]'), 'https://cdn.example.com/a.jpg');
      typeInto(body.querySelector('textarea'), 'Mô tả mới');
      click(byText(body, 'button', 'Giặt tẩy'));
      click(byText(body, 'button', 'Lưu'));
      await flush();
      const patch = m.calls.find((c) => c.init?.method === 'PATCH')!;
      expect(JSON.parse(String(patch.init?.body))).toEqual({
        images: ['https://cdn.example.com/a.jpg'], description: 'Mô tả mới', shortDesc: null, isActive: true, isFeatured: false, categoryIds: ['c1'],
      });
      expect(body.textContent).toContain('Đã lưu.');
    });

    it('hàng của đối tác: không có ô ảnh/mô tả và không gửi chúng', async () => {
      const { m, container } = editSetup({ ...DETAIL, partnerOwned: true, managedByPancake: false });
      await flush();
      click(container.querySelector('button[aria-label="Sửa Nước rửa chén"]'));
      await flush();
      expect(document.body.querySelector('textarea')).toBeNull();
      click(byText(document.body, 'button', 'Lưu'));
      await flush();
      const patch = m.calls.find((c) => c.init?.method === 'PATCH')!;
      expect(Object.keys(JSON.parse(String(patch.init?.body))).sort()).toEqual(['categoryIds', 'isActive', 'isFeatured']);
    });

    it('sản phẩm đang bị Pancake giữ: nói rõ lý do chưa bật bán được', async () => {
      const { container } = editSetup({ ...DETAIL, isActive: false, cannotShowReason: 'Đang bị Pancake giữ lại (đã xoá khỏi Pancake hoặc chưa có giá).' });
      await flush();
      click(container.querySelector('button[aria-label="Sửa Nước rửa chén"]'));
      await flush();
      expect(document.body.textContent).toContain('Chưa bật bán được: Đang bị Pancake giữ lại');
    });
  });
});
