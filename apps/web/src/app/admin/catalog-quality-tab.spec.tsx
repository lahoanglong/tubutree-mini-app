// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { KNOWN_MEDIA_MISMATCHES } from '@tubutree/app-core/commerce/catalog-quality-audit';
import { CatalogQualityTab } from './catalog-quality-tab';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

const BAD = KNOWN_MEDIA_MISMATCHES[0]!;
const LIST = [
  { slug: `${BAD.baseSlug}-c1337b`, name: 'Nước rửa chén Fuwa3e 100ml', thumbnail: BAD.badThumbnail, inStock: true },
  { slug: 'sp-thieu-anh', name: 'Sản phẩm thiếu ảnh', thumbnail: null, inStock: true },
  { slug: 'sp-trong-mo-ta', name: 'Sản phẩm trống mô tả', thumbnail: 'https://x/ok.png', inStock: false },
  { slug: 'sp-on', name: 'Sản phẩm ổn', thumbnail: 'https://x/on.png', inStock: true },
];
const routes = (over: Record<string, { status?: number; body: unknown }> = {}) => ({
  '/products?page=1': { body: { data: LIST, meta: { page: 1, limit: 100, total: 4 } } },
  [`/products/${LIST[0]!.slug}`]: { body: { description: 'Mô tả đủ' } },
  '/products/sp-thieu-anh': { body: { description: 'Có mô tả' } },
  '/products/sp-trong-mo-ta': { body: { description: '<p>&nbsp;</p>' } },
  '/products/sp-on': { body: { description: 'Ổn' } },
  ...over,
});
const runCheck = async (r: Rendered) => {
  click(byText(r.container, 'button', 'Kiểm tra ngay'));
  await flush(20);
};

describe('CatalogQualityTab', () => {
  it('lúc đầu chưa gọi mạng, chỉ có nút Kiểm tra ngay; tiêu đề thu gọn/mở rộng được', async () => {
    const m = mockFetch(routes());
    vi.stubGlobal('fetch', m.fn);
    const r = mount(<CatalogQualityTab />);
    await flush();
    expect(m.calls).toHaveLength(0);
    expect(r.container.textContent).toContain('Kiểm tra chất lượng Catalog');
    expect(byText(r.container, 'button', 'Kiểm tra ngay')).not.toBeNull();
    const toggle = r.container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(byText(r.container, 'button', 'Kiểm tra ngay')).toBeNull();
    click(toggle);
    expect(byText(r.container, 'button', 'Kiểm tra ngay')).not.toBeNull();
  });

  it('bấm kiểm tra: đọc danh sách rồi mô tả từng sản phẩm, hiện số đếm và từng dòng lỗi có câu hướng dẫn', async () => {
    const m = mockFetch(routes());
    vi.stubGlobal('fetch', m.fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    expect(m.calls.filter((c) => c.url.includes('/products?page=1&limit=100'))).toHaveLength(1);
    expect(m.calls.filter((c) => /\/products\/[^?]/.test(c.url))).toHaveLength(4);
    const t = r.container.textContent ?? '';
    expect(t).toContain('Đã kiểm 4 sản phẩm: 3 sản phẩm cần sửa, trong đó 2 đang còn hàng.');
    expect(t).toContain('Tất cả (3)');
    expect(t).toContain('Ảnh lệch tên (1)');
    expect(t).toContain('Thiếu ảnh (1)');
    expect(t).toContain('Trống mô tả (1)');
    expect(t).toContain('Nước rửa chén Fuwa3e 100ml');
    expect(t).toContain('Vệ sinh bồn cầu Eco Enzyme 100ml');
    expect(t).not.toContain('Sản phẩm ổn');
    expect(r.container.querySelectorAll('ul[aria-label="Sản phẩm cần sửa"] > li')).toHaveLength(3);
    expect(t).toContain('Hết hàng');
    expect(byText(r.container, 'button', 'Kiểm tra lại')).not.toBeNull();
  });

  it('lọc theo loại lỗi và nút bấm đủ lớn cho ngón tay (44px)', async () => {
    vi.stubGlobal('fetch', mockFetch(routes()).fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    click(byText(r.container, 'button', 'Thiếu ảnh (1)'));
    const items = Array.from(r.container.querySelectorAll('ul[aria-label="Sản phẩm cần sửa"] > li'));
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('Sản phẩm thiếu ảnh');
    expect(byText(r.container, 'button', 'Thiếu ảnh (1)')!.getAttribute('aria-pressed')).toBe('true');
    click(byText(r.container, 'button', 'Tất cả (3)'));
    expect(r.container.querySelectorAll('ul[aria-label="Sản phẩm cần sửa"] > li')).toHaveLength(3);
    for (const b of Array.from(r.container.querySelectorAll('button'))) expect(b.className, b.textContent ?? '').toMatch(/min-h-\[44px\]/);
  });

  it('không lỗi nào: báo sạch, không dựng danh sách', async () => {
    const clean = [{ slug: 'a', name: 'A', thumbnail: 'https://x/a.png', inStock: true }];
    vi.stubGlobal('fetch', mockFetch({ '/products?page=1': { body: { data: clean, meta: { page: 1, limit: 100, total: 1 } } }, '/products/a': { body: { description: 'Có chữ' } } }).fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    expect(r.container.textContent).toContain('Đã kiểm 1 sản phẩm, không có lỗi.');
    expect(r.container.querySelector('ul[aria-label="Sản phẩm cần sửa"]')).toBeNull();
  });

  it('lỗi đọc danh sách: báo lỗi kèm Thử lại; thử lại thành công thì hiện kết quả', async () => {
    let fail = true;
    const m = mockFetch({
      ...routes(),
      '/products?page=1': () => (fail ? { status: 500, body: { message: 'x' } } : { body: { data: LIST, meta: { page: 1, limit: 100, total: 4 } } }),
    });
    vi.stubGlobal('fetch', m.fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Không đọc được catalog');
    expect(r.container.textContent).not.toContain('Đã kiểm');
    fail = false;
    click(byText(r.container, '[role="alert"] button', 'Thử lại'));
    await flush(20);
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
    expect(r.container.textContent).toContain('Đã kiểm 4 sản phẩm');
  });

  it('một sản phẩm đọc mô tả lỗi: báo số sản phẩm chưa kiểm mô tả và không báo oan trống mô tả cho nó', async () => {
    vi.stubGlobal('fetch', mockFetch(routes({ '/products/sp-trong-mo-ta': { status: 500, body: { message: 'x' } } })).fn);
    const r = mount(<CatalogQualityTab />);
    await runCheck(r);
    const t = r.container.textContent ?? '';
    expect(t).toContain('Chưa đọc được mô tả của 1 sản phẩm');
    expect(t).toContain('Trống mô tả (0)');
    expect(t).toContain('Đã kiểm 4 sản phẩm: 2 sản phẩm cần sửa');
  });

  it('bấm hai lần liền chỉ chạy một lượt (nút khoá trong lúc đang kiểm)', async () => {
    const m = mockFetch(routes());
    vi.stubGlobal('fetch', m.fn);
    const r = mount(<CatalogQualityTab />);
    const btn = byText(r.container, 'button', 'Kiểm tra ngay')!;
    click(btn);
    click(btn);
    await flush(20);
    expect(m.calls.filter((c) => c.url.includes('/products?page=1'))).toHaveLength(1);
  });
});
