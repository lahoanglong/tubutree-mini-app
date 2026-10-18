import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// @vitest-environment jsdom
// Danh mục + tìm kiếm đã chuyển sang /san-pham (san-pham/page.spec.tsx); trang chủ giữ hero, lối vào danh mục, cam kết và dải sản phẩm.

const mocks = vi.hoisted(() => ({ getProductsPage: vi.fn(), getCategories: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getProductsPage: mocks.getProductsPage,
  getCategories: mocks.getCategories,
}));
import HomePage from './page';

const PRODUCT = {
  id: 'p1', slug: 'dau-goi', brand: 'Tubu', name: 'Dầu gội bồ kết', thumbnail: null, basePrice: 200000,
  salePrice: null, isFeatured: false, inStock: true,
};
const CATEGORIES = [
  { id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4 },
  { id: 'c-trong', parentId: null, name: 'Danh mục trống', slug: 'trong', image: null, sortOrder: 2, productCount: 0 },
  { id: 'c-xa', parentId: null, name: 'Xà phòng', slug: 'xa-phong', image: null, sortOrder: 3, productCount: 2 },
];
const pageOf = (data: unknown[], total = data.length, page = 1) => ({ data, meta: { page, limit: 24, total } });
const render = async () => renderToStaticMarkup(await HomePage());

beforeEach(() => {
  mocks.getProductsPage.mockReset().mockResolvedValue(pageOf([PRODUCT]));
  mocks.getCategories.mockReset().mockResolvedValue(CATEGORIES);
});

describe('HomePage — lối vào danh mục sản phẩm', () => {
  it('tải một trang sản phẩm đầu cho dải nổi bật, không còn nhận ?q/?brand/?page (đã sang /san-pham)', async () => {
    await render();
    expect(mocks.getProductsPage).toHaveBeenCalledWith({});
  });

  it('có nút "Xem tất cả sản phẩm" và nút "Mua sắm ngay" trên hero dẫn sang /san-pham', async () => {
    const out = await render();
    expect(out).toMatch(/<a [^>]*href="\/san-pham"[^>]*>[\s\S]*?Mua sắm ngay/);
    expect(out).toMatch(/<a [^>]*href="\/san-pham"[^>]*>Xem tất cả sản phẩm/);
  });

  it('không còn ô lọc thương hiệu hay dòng kết quả tìm kiếm trên trang chủ', async () => {
    const out = await render();
    expect(out).not.toContain('Danh Mục Thương Hiệu');
    expect(out).not.toContain('Kết quả tìm kiếm');
  });

  it('giữ cấu trúc heading: đúng một h1, h2 trước h3', async () => {
    const out = await render();
    expect(out.match(/<h1[ >]/g)).toHaveLength(1);
    expect(out.indexOf('<h2')).toBeLessThan(out.indexOf('<h3'));
  });

  it('catalog rỗng: vẫn có trang chủ, báo chưa có sản phẩm và lối sang /san-pham', async () => {
    mocks.getProductsPage.mockResolvedValue(pageOf([], 0));
    const out = await render();
    expect(out).toContain('Chưa có sản phẩm phù hợp');
    expect(out).toContain('Mỹ Phẩm');
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
    const out = await render();
    expect(out.match(/Hết hàng/g)).toHaveLength(1);
    expect(out).not.toContain('-50%');
  });

  it('thiếu cờ inStock (API cũ) thì không dán nhãn nhầm', async () => {
    const { inStock: _drop, ...noFlag } = PRODUCT;
    mocks.getProductsPage.mockResolvedValue(pageOf([noFlag]));
    expect(await render()).not.toContain('Hết hàng');
  });
});

describe('HomePage — ảnh thẻ sản phẩm (D6-12)', () => {
  it('4 thẻ đầu tải ngay với fetchpriority=high, các thẻ sau tải lười', async () => {
    const products = Array.from({ length: 7 }, (_, i) => ({ ...PRODUCT, id: `p${i}`, slug: `sp-${i}`, thumbnail: `https://cdn.example/${i}.jpg` }));
    mocks.getProductsPage.mockResolvedValue(pageOf(products));
    const imgs = [...(await render()).matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs).toHaveLength(7);
    expect(imgs.map((i) => /loading="(\w+)"/.exec(i)?.[1])).toEqual(['eager', 'eager', 'eager', 'eager', 'lazy', 'lazy', 'lazy']);
    expect(imgs.map((i) => /fetchPriority="(\w+)"/i.exec(i)?.[1])).toEqual(['high', 'high', 'high', 'high', undefined, undefined, undefined]);
  });
});

// D7 việc 1: khách mới vào trang chủ phải thấy lối vào theo danh mục ngay dưới hero, và cam kết chỉ còn một hàng.
describe('HomePage — hàng danh mục và hàng cam kết (D7)', () => {
  it('trang chủ không dùng lời hứa tuyệt đối "100%"', async () => {
    expect(await render()).not.toContain('100%');
  });

  it('hàng danh mục liệt kê danh mục còn hàng, bỏ danh mục trống, mỗi liên kết ≥ 44px và đi sang /san-pham?category=', async () => {
    const out = await render();
    expect(out).toContain('aria-label="Mua theo danh mục"');
    expect(out).toMatch(/<a [^>]*min-h-11[^>]*href="\/san-pham\?category=c-goi"[^>]*>Dầu gội/);
    expect(out).toContain('href="/san-pham?category=c-xa"');
    expect(out).not.toContain('Danh mục trống');
    expect(out.indexOf('Mua theo danh mục')).toBeGreaterThan(out.indexOf('<h1'));
    expect(out.indexOf('Mua theo danh mục')).toBeLessThan(out.indexOf('Cam kết của Tubu Tree'));
  });

  it('không có danh mục nào còn hàng (hoặc API cũ không trả): không vẽ hàng danh mục', async () => {
    mocks.getCategories.mockResolvedValue([CATEGORIES[1]]);
    expect(await render()).not.toContain('Mua theo danh mục');
    mocks.getCategories.mockResolvedValue([]);
    expect(await render()).not.toContain('Mua theo danh mục');
  });

  it('ba cam kết nằm trên một hàng ở mọi cỡ màn hình, vẫn giữ đủ ba cam kết', async () => {
    const out = await render();
    const section = /<section aria-labelledby="cam-ket"[\s\S]*?<\/section>/.exec(out)?.[0] ?? '';
    expect(section).toContain('grid-cols-3');
    expect(section).not.toContain('grid-cols-1');
    expect(section.match(/<h3/g)).toHaveLength(3);
    expect(section).toContain('Đổi Trả 7 Ngày');
  });

  it('API danh mục lỗi không làm hỏng trang chủ: hiện lưới sản phẩm, bỏ hàng danh mục', async () => {
    mocks.getCategories.mockRejectedValue(new Error('down'));
    const out = await render();
    expect(out).toContain('Dầu gội bồ kết');
    expect(out).not.toContain('Mua theo danh mục');
  });
});
