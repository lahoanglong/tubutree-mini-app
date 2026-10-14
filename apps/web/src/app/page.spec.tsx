import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// C-025 (A1-014): trang chủ web nhận ?q= (từ ô tìm kiếm ở header) và chuyển cho GET /products?q=.

const mocks = vi.hoisted(() => ({ getProductsPage: vi.fn(), getBrands: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getProductsPage: mocks.getProductsPage,
  getBrands: mocks.getBrands,
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

import HomePage, { generateMetadata } from './page';

const PRODUCT = {
  id: 'p1', slug: 'dau-goi', brand: 'Tubu', name: 'Dầu gội bồ kết', thumbnail: null, basePrice: 200000,
  salePrice: null, isFeatured: false, inStock: true,
};
const pageOf = (data: unknown[], total = data.length, page = 1) => ({ data, meta: { page, limit: 24, total } });
const render = async (sp: Record<string, string | string[] | undefined>) =>
  renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  mocks.getProductsPage.mockReset().mockResolvedValue(pageOf([PRODUCT]));
  mocks.redirect.mockReset();
  mocks.getBrands.mockReset().mockResolvedValue([{ brand: 'Tubu', count: 3 }, { brand: 'A&B', count: 1 }]);
});

describe('HomePage — tìm kiếm', () => {
  it('không có ?q: gọi API như cũ (không có tham số q), không hiện dòng kết quả tìm kiếm', async () => {
    const out = await render({});
    expect(mocks.getProductsPage).toHaveBeenCalledWith({});
    expect(out).not.toContain('Kết quả tìm kiếm');
  });

  it('?q=: chuyển từ khoá đã chuẩn hoá cho API, nói rõ đang xem kết quả và có lối xoá tìm kiếm', async () => {
    const out = await render({ q: '  dầu   gội ' });
    expect(mocks.getProductsPage).toHaveBeenCalledWith({ q: 'dầu gội' });
    expect(out).toContain('Kết quả tìm kiếm cho');
    expect(out).toContain('dầu gội');
    expect(out).toMatch(/<a [^>]*href="\/"[^>]*>Xóa tìm kiếm<\/a>/);
  });

  it('lọc thương hiệu giữ từ khoá, xoá tìm kiếm giữ thương hiệu', async () => {
    const out = await render({ q: 'gội', brand: 'A&B' });
    expect(mocks.getProductsPage).toHaveBeenCalledWith({ brand: 'A&B', q: 'gội' });
    expect(out).toContain('href="/?brand=Tubu&amp;q=g%E1%BB%99i#san-pham"');
    expect(out).toContain('href="/?brand=A%26B#san-pham"');
  });

  it('không có kết quả cho từ khoá: câu báo riêng cho tìm kiếm, không đổ lỗi cho bộ lọc thương hiệu', async () => {
    mocks.getProductsPage.mockResolvedValue(pageOf([]));
    const out = await render({ q: 'xyz' });
    expect(out).toContain('Không tìm thấy sản phẩm nào cho');
    expect(out).toContain('xyz');
  });

  it('?q lặp lại (mảng) hoặc rỗng không làm trang lỗi', async () => {
    await render({ q: ['a', 'b'] });
    expect(mocks.getProductsPage).toHaveBeenLastCalledWith({ q: 'a' });
    await render({ q: '   ' });
    expect(mocks.getProductsPage).toHaveBeenLastCalledWith({});
  });

  it('trang kết quả tìm kiếm không cho công cụ tìm kiếm lập chỉ mục (vô hạn biến thể URL)', async () => {
    expect(await generateMetadata({ searchParams: Promise.resolve({ q: 'gội' }) })).toEqual({ robots: { index: false, follow: true } });
    expect(await generateMetadata({ searchParams: Promise.resolve({}) })).toEqual({ alternates: { canonical: '/' } });
  });

  it('trang phân trang và trang nhãn có tiêu đề + canonical riêng (R2-BUYERWEB-9); nhãn không có thật thì noindex', async () => {
    const p2 = await generateMetadata({ searchParams: Promise.resolve({ page: '2' }) });
    expect(p2.title).toBe('Sản phẩm sống xanh — Trang 2 | Tubu Tree');
    expect(p2.alternates).toEqual({ canonical: '/?page=2' });
    const brand = await generateMetadata({ searchParams: Promise.resolve({ brand: 'Tubu' }) });
    expect(brand.title).toBe('Sản phẩm Tubu | Tubu Tree');
    expect(brand.robots).toBeUndefined();
    const fake = await generateMetadata({ searchParams: Promise.resolve({ brand: 'khong-co' }) });
    expect(fake.robots).toEqual({ index: false, follow: true });
  });

  it('nhãn đã công khai: lọc theo nhãn có liên kết tới /brand/:slug (BUYERWEB-18)', async () => {
    mocks.getBrands.mockResolvedValue([{ brand: 'Tubu', count: 3, slug: 'tubu-xanh' }, { brand: 'A&B', count: 1, slug: null }]);
    const withPage = await render({ brand: 'Tubu' });
    expect(withPage).toMatch(/<a [^>]*href="\/brand\/tubu-xanh"[^>]*>Xem trang nhãn hàng Tubu/);
    expect(await render({ brand: 'A&B' })).not.toContain('Xem trang nhãn hàng');
    expect(await render({})).not.toContain('Xem trang nhãn hàng');
  });

  it('giữ cấu trúc heading: đúng một h1, h2 trước h3', async () => {
    const out = await render({ q: 'gội' });
    expect(out.match(/<h1[ >]/g)).toHaveLength(1);
    expect(out.indexOf('<h2')).toBeLessThan(out.indexOf('<h3'));
  });
});

// BUYERWEB-7: trang chủ từng chỉ tải 30 sản phẩm đầu, bỏ meta.total và in "30 sản phẩm đang bán" dù catalog có 45.
describe('HomePage — phân trang và tổng số sản phẩm (BUYERWEB-7)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...PRODUCT, id: `p${i}`, slug: `sp-${i}` }));

  it('nhãn ghi TỔNG số sản phẩm của API (meta.total), không phải số đang hiện trên trang', async () => {
    mocks.getProductsPage.mockResolvedValue(pageOf(many(24), 45));
    const out = await render({});
    expect(out).toContain('45 sản phẩm đang bán');
    expect(out).not.toContain('24 sản phẩm đang bán');
  });

  it('có thanh phân trang khi nhiều hơn một trang: trang 1 đang xem, có liên kết sang trang 2 và nút Trang sau', async () => {
    mocks.getProductsPage.mockResolvedValue(pageOf(many(24), 45));
    const out = await render({});
    expect(out).toContain('aria-label="Phân trang sản phẩm"');
    expect(out).toContain('aria-current="page"');
    expect(out).toContain('href="/?page=2#san-pham"');
    expect(out).toMatch(/<a [^>]*rel="next"[^>]*>/);
    expect(out).not.toMatch(/<a [^>]*rel="prev"[^>]*>/);
  });

  it('?page=2 gọi API đúng trang, giữ bộ lọc trong liên kết phân trang và có nút Trang trước', async () => {
    mocks.getProductsPage.mockResolvedValue(pageOf(many(21), 45, 2));
    const out = await render({ page: '2', brand: 'A&B' });
    expect(mocks.getProductsPage).toHaveBeenLastCalledWith({ brand: 'A&B', page: '2' });
    expect(out).toContain('href="/?brand=A%26B#san-pham"');
    expect(out).toMatch(/<a [^>]*rel="prev"[^>]*>/);
    expect(out).not.toMatch(/<a [^>]*rel="next"[^>]*>/);
  });

  it('một trang duy nhất: không vẽ thanh phân trang', async () => {
    mocks.getProductsPage.mockResolvedValue(pageOf(many(10), 10));
    expect(await render({})).not.toContain('Phân trang sản phẩm');
  });

  it('?page rác (abc, 0, -3) về trang 1 và không ghi tham số page cho API', async () => {
    for (const page of ['abc', '0', '-3']) {
      await render({ page });
      expect(mocks.getProductsPage).toHaveBeenLastCalledWith({});
    }
  });

  it('?page vượt trang cuối: chuyển về trang cuối thay vì báo chưa có sản phẩm', async () => {
    mocks.getProductsPage.mockResolvedValue(pageOf([], 45, 9));
    await expect(render({ page: '9' })).rejects.toThrow('NEXT_REDIRECT /?page=2#san-pham');
    expect(mocks.redirect).toHaveBeenCalledWith('/?page=2#san-pham');
  });

  it('catalog thật sự rỗng: vẫn hiện "Chưa có sản phẩm phù hợp", không chuyển hướng', async () => {
    mocks.getProductsPage.mockResolvedValue(pageOf([], 0));
    const out = await render({});
    expect(out).toContain('Chưa có sản phẩm phù hợp');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('ProductCard — nhãn hết hàng (BUYERWEB-9)', () => {
  it('sản phẩm hết hàng có nhãn "Hết hàng" và không còn huy hiệu giảm giá; còn hàng thì không có nhãn', async () => {
    mocks.getProductsPage.mockResolvedValue(
      pageOf([
        { ...PRODUCT, id: 'a', slug: 'het', inStock: false, salePrice: 100000 },
        { ...PRODUCT, id: 'b', slug: 'con', inStock: true },
      ]),
    );
    const out = await render({});
    expect(out.match(/Hết hàng/g)).toHaveLength(1);
    expect(out).not.toContain('-50%');
  });

  it('thiếu cờ inStock (API cũ) thì không dán nhãn nhầm', async () => {
    const { inStock: _drop, ...noFlag } = PRODUCT;
    mocks.getProductsPage.mockResolvedValue(pageOf([noFlag]));
    expect(await render({})).not.toContain('Hết hàng');
  });
});
