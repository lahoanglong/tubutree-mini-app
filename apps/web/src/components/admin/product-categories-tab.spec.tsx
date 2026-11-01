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

const cat = (id: string, name: string, parentId: string | null, sortOrder: number, productCount = 0, totalCount = productCount) => ({
  id,
  name,
  slug: id,
  parentId,
  sortOrder,
  productCount,
  totalCount,
});
const LIMITS = { maxRoots: 8, maxChildren: 8 };
const TREE = {
  items: [cat('c1', 'Giặt tẩy', null, 0, 3), cat('c2', 'Nhà bếp', null, 1, 0), cat('c9', 'Gia dụng', null, 2, 0, 1), cat('c10', 'Dao thớt', 'c9', 0, 1)],
  limits: LIMITS,
};
const INBOX = { generatedAt: '2026-11-01T03:00:00.000Z', items: [{ key: 'productsUncategorized', count: 2 }, { key: 'productsMissingImage', count: 7 }] };

function setup(props: { initialMissingImage?: boolean; initialUncategorized?: boolean } = {}) {
  let tree = TREE;
  const m = mockFetch({
    '/admin/product-categories/assign': { body: { requested: 2, changed: 1, unchanged: 1, category: { id: 'c2', name: 'Nhà bếp' } } },
    '/admin/product-categories/products': { body: PAGE },
    '/admin/pancake/categories': { body: [{ id: '865301', name: 'Bếp', path: 'Nhà > Bếp', mappedTo: 'c2' }] },
    '/admin/ops/inbox': { body: INBOX },
    '/admin/categories/order': (init) => {
      const b = JSON.parse(String(init?.body)) as { orderedIds: string[] };
      tree = { ...tree, items: tree.items.map((c) => (b.orderedIds.includes(c.id) ? { ...c, sortOrder: b.orderedIds.indexOf(c.id) } : c)) };
      return { body: tree };
    },
    '/admin/categories': () => ({ body: tree }),
  });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  const r = render(<ProductCategoriesTab {...props} />);
  mounted.push(r);
  return { m, container: r.container };
}

describe('ProductCategoriesTab (gán danh mục hàng loạt)', () => {
  it('mặc định hiện mọi sản phẩm (không lọc sẵn), mục tên "Sản phẩm" kèm panel cây danh mục; chip "Đang bán, chưa có danh mục" lấy số từ hộp việc và lọc hàng đang bán', async () => {
    const { m, container } = setup();
    await flush();
    const list = m.calls.find((c) => c.url.includes('/admin/product-categories/products') && !c.url.includes('uncategorized=1'))!;
    expect(list.url).not.toContain('uncategorized=1');
    expect(list.url).not.toContain('source=pancake');
    expect(container.querySelector('h2')!.textContent).toBe('Sản phẩm');
    expect(byText(container, 'h3', 'Cây danh mục')).not.toBeNull();
    expect(container.textContent).toContain('Giặt tẩy');
    // Số cạnh chip là số của thẻ hộp việc (chỉ hàng đang bán), không đếm bằng một truy vấn danh sách riêng.
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Đang bán, chưa có danh mục (2)')).toBe(true);
    expect(m.calls.filter((c) => c.url.includes('/admin/product-categories/products'))).toHaveLength(1);
    click(byText(container, 'button', 'Đang bán, chưa có danh mục'));
    await flush();
    const filtered = m.calls.filter((c) => c.url.includes('/admin/product-categories/products')).at(-1)!;
    expect(filtered.url).toContain('uncategorized=1');
    expect(filtered.url).toContain('onSale=1');
  });

  it('bộ chọn danh mục theo thứ tự cây quản trị: mục con thụt "— ", mục cha có con ghi "(có mục con)"', async () => {
    const { m, container } = setup();
    await flush();
    const options = [...container.querySelectorAll('select[aria-label="Danh mục"] option')].map((o) => o.textContent ?? '');
    expect(options).toEqual(['Chọn danh mục…', 'Giặt tẩy (3)', 'Nhà bếp (0)', 'Gia dụng (có mục con)', '— Dao thớt (1)']);
    expect(m.calls.some((c) => c.url.endsWith('/admin/categories'))).toBe(true);
    expect(m.calls.some((c) => c.url.includes('/categories?flat=1'))).toBe(false);
  });

  it('chọn mục cha có mục con: khoá "Gán danh mục", giải thích, vẫn cho "Gỡ danh mục"', async () => {
    const { container } = setup();
    await flush();
    click(container.querySelector('label input[type="checkbox"]'));
    selectValue(container.querySelector('select[aria-label="Danh mục"]'), 'c9');
    await flush();
    const buttons = () => Array.from(container.querySelectorAll('button'));
    expect(buttons().find((b) => b.textContent === 'Gán danh mục')!.disabled).toBe(true);
    expect(buttons().find((b) => b.textContent === 'Gỡ danh mục')!.disabled).toBe(false);
    expect(container.textContent).toContain('Mục này có mục con. Chọn một mục con để gán.');
    selectValue(container.querySelector('select[aria-label="Danh mục"]'), 'c10');
    await flush();
    expect(buttons().find((b) => b.textContent === 'Gán danh mục')!.disabled).toBe(false);
    expect(container.textContent).not.toContain('Mục này có mục con');
  });

  it('mở từ thẻ hộp việc (initialUncategorized): chip bật sẵn, lọc đang bán, panel cây thu gọn nhường chỗ cho danh sách', async () => {
    const { m, container } = setup({ initialUncategorized: true });
    await flush();
    const chip = [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Đang bán, chưa có danh mục'))!;
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    const first = m.calls.find((c) => c.url.includes('/admin/product-categories/products'))!;
    expect(first.url).toContain('uncategorized=1');
    expect(first.url).toContain('onSale=1');
    expect(container.querySelector('ul[aria-label="Cây danh mục"]')).toBeNull();
    click(byText(container, 'button', 'Mở rộng'));
    await flush();
    expect(container.querySelector('ul[aria-label="Cây danh mục"]')).not.toBeNull();
  });

  it('đổi thứ tự trong panel: gửi PUT order rồi bộ chọn danh mục đổi theo thứ tự mới', async () => {
    const { m, container } = setup();
    await flush();
    click([...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Đưa "Nhà bếp" lên trên') ?? null);
    await flush();
    const put = m.calls.find((c) => c.init?.method === 'PUT')!;
    expect(JSON.parse(String(put.init!.body))).toEqual({ parentId: null, orderedIds: ['c2', 'c1', 'c9'] });
    const options = [...container.querySelectorAll('select[aria-label="Danh mục"] option')].map((o) => o.textContent ?? '');
    expect(options.slice(1, 3)).toEqual(['Nhà bếp (0)', 'Giặt tẩy (3)']);
  });

  it('chip "Đang bán, thiếu ảnh" ghi số từ hộp việc; mở từ thẻ hộp việc thì bật sẵn', async () => {
    const m = mockFetch({
      '/admin/ops/inbox': { body: { generatedAt: '2026-10-28T03:00:00.000Z', items: [{ key: 'productsMissingImage', count: 7 }] } },
      '/admin/product-categories/products': { body: PAGE },
      '/admin/pancake/categories': { body: [] },
      '/admin/categories': { body: { items: [], limits: LIMITS } },
    });
    vi.stubGlobal('fetch', vi.fn(m.fn));
    const r = render(<ProductCategoriesTab initialMissingImage />);
    mounted.push(r);
    await flush();
    const chip = [...r.container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Đang bán, thiếu ảnh'))!;
    expect(chip.textContent).toBe('Đang bán, thiếu ảnh (7)');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(m.calls.some((c) => c.url.includes('/admin/product-categories/products') && c.url.includes('missingImage=1'))).toBe(true);
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
      '/admin/categories': { status: 503, body: { message: 'Máy chủ đang bận, vui lòng thử lại sau.' } },
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
        '/admin/categories': { body: { items: [cat('c1', 'Giặt tẩy', null, 0, 3), cat('c9', 'Gia dụng', null, 1, 0, 1), cat('c10', 'Dao thớt', 'c9', 0, 1)], limits: LIMITS } },
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
        images: ['https://cdn.example.com/a.jpg'], description: 'Mô tả mới', categoryIds: ['c1'],
      });
      expect(body.textContent).toContain('Đã lưu.');
    });

    it('hàng của đối tác: không có ô ảnh/mô tả và không gửi chúng', async () => {
      const { m, container } = editSetup({ ...DETAIL, partnerOwned: true, managedByPancake: false });
      await flush();
      click(container.querySelector('button[aria-label="Sửa Nước rửa chén"]'));
      await flush();
      expect(document.body.querySelector('textarea')).toBeNull();
      expect(document.body.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.disabled).toBe(true);
      click(byText(document.body, 'button', 'Giặt tẩy'));
      click(byText(document.body, 'button', 'Lưu'));
      await flush();
      const patch = m.calls.find((c) => c.init?.method === 'PATCH')!;
      expect(Object.keys(JSON.parse(String(patch.init?.body))).sort()).toEqual(['categoryIds']);
    });

    it('chưa sửa gì thì nút Lưu khoá; chỉ đổi nổi bật thì chỉ gửi isFeatured; có ghi chú đồng bộ Pancake sẽ đè ảnh và mô tả', async () => {
      const { m, container } = editSetup();
      await flush();
      click(container.querySelector('button[aria-label="Sửa Nước rửa chén"]'));
      await flush();
      const save = byText(document.body, 'button', 'Lưu') as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      expect(document.body.textContent).toContain('bị thay bằng ảnh của Pancake');
      click(Array.from(document.body.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]'))[1]!);
      await flush();
      expect(save.disabled).toBe(false);
      click(save);
      await flush();
      const patch = m.calls.find((c) => c.init?.method === 'PATCH')!;
      expect(JSON.parse(String(patch.init?.body))).toEqual({ isFeatured: true });
    });

    it('sản phẩm đang bị Pancake giữ: nói rõ lý do chưa bật bán được', async () => {
      const { container } = editSetup({ ...DETAIL, isActive: false, cannotShowReason: 'Đang bị Pancake giữ lại (đã xoá khỏi Pancake hoặc chưa có giá).' });
      await flush();
      click(container.querySelector('button[aria-label="Sửa Nước rửa chén"]'));
      await flush();
      expect(document.body.textContent).toContain('Chưa bật bán được: Đang bị Pancake giữ lại');
    });

    it('chip danh mục trong ngăn sửa: mục cha có con bị khoá, mục con ghi "Cha › Con" và lưu đúng id', async () => {
      const { m, container } = editSetup();
      await flush();
      click(container.querySelector('button[aria-label="Sửa Nước rửa chén"]'));
      await flush();
      const parent = byText(document.body, 'button', 'Gia dụng') as HTMLButtonElement;
      expect(parent.textContent).toBe('Gia dụng');
      expect(parent.disabled).toBe(true);
      click(byText(document.body, 'button', 'Gia dụng › Dao thớt'));
      click(byText(document.body, 'button', 'Lưu'));
      await flush();
      const patch = m.calls.find((c) => c.init?.method === 'PATCH')!;
      expect(JSON.parse(String(patch.init?.body))).toEqual({ categoryIds: ['c10'] });
    });

    it('sản phẩm đã nằm sẵn ở mục cha (dữ liệu cũ): chip mục cha vẫn bấm được để gỡ', async () => {
      const { container } = editSetup({ ...DETAIL, categoryIds: ['c9'] });
      await flush();
      click(container.querySelector('button[aria-label="Sửa Nước rửa chén"]'));
      await flush();
      const parent = byText(document.body, 'button', 'Gia dụng') as HTMLButtonElement;
      expect(parent.getAttribute('aria-pressed')).toBe('true');
      expect(parent.disabled).toBe(false);
    });
  });
});
