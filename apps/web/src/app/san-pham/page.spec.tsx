import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// @vitest-environment jsdom
// Danh mục + tìm kiếm chuyển từ "/" sang /san-pham (00-ma-tran dòng 2): trang server tải sẵn danh sách đầu cho đúng URL,
// giữ SEO (canonical, noindex khi có q/lọc) rồi BrowseView của client tiếp quản.

const mocks = vi.hoisted(() => ({ get: vi.fn(), redirect: vi.fn(), view: vi.fn() }));
vi.mock('@/lib/core-http-server', () => ({ createServerHttp: () => ({ get: mocks.get }) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('@/components/catalog/browse-view', () => ({
  PAGE_LIMIT: 24,
  default: (props: unknown) => {
    mocks.view(props);
    return <div data-testid="browse-view" />;
  },
}));

import BrowsePage, { generateMetadata } from './page';

const PRODUCT = { id: 'p1', slug: 'dau-goi', brand: 'Tubu', name: 'Dầu gội bồ kết', thumbnail: null, basePrice: 200000, salePrice: null, isFeatured: false, inStock: true };
const CATEGORIES = [{ id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4 }];
const BRANDS = [{ brand: 'Tubu', count: 3, slug: 'tubu-xanh' }, { brand: 'A&B', count: 1 }];
const pageOf = (data: unknown[], total = data.length, page = 1) => ({ data, meta: { page, limit: 24, total } });

let catalog: () => unknown;
beforeEach(() => {
  mocks.redirect.mockReset();
  mocks.view.mockReset();
  catalog = () => pageOf([PRODUCT]);
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/products') return catalog();
    if (path === '/brands') return BRANDS;
    if (path === '/categories') return CATEGORIES;
    throw new Error(`đường dẫn lạ ${path}`);
  });
});

const sp = (o: Record<string, string | string[] | undefined>) => Promise.resolve(o);
const render = async (o: Record<string, string | string[] | undefined>) => renderToStaticMarkup(await BrowsePage({ searchParams: sp(o) }));
const productCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/products');

describe('BrowsePage — dữ liệu ban đầu', () => {
  it('main không ghép max-md:pt với sm:py (sm: thắng ở 640-767px)', async () => {
    const cls = /<main[^>]*class="([^"]*)"/.exec(await render({}))![1]!;
    expect(cls).not.toMatch(/(^|\s)sm:py-/);
  });

  it('không có tham số: gọi GET /products trang 1, 24 sản phẩm, và giao danh sách + nhãn + danh mục cho BrowseView', async () => {
    await render({});
    expect(productCalls()).toEqual([['/products', { query: { page: 1, limit: 24 } }]]);
    const props = mocks.view.mock.calls[0]![0] as { initial: { urlKey: string; startPage: number; page: unknown }; brands: unknown; categories: unknown };
    expect(props.initial).toEqual({ urlKey: '', startPage: 1, page: { ...pageOf([PRODUCT]), filtersIgnored: false } });
    expect(props.brands).toEqual(BRANDS);
    expect(props.categories).toEqual(CATEGORIES);
  });

  it('?q= cắt khoảng trắng đầu cuối, ?sort/?minPrice/?inStock/?rating/?brand đi đúng tham số API như Mini App; urlKey là khoá chuẩn', async () => {
    await render({ q: '  dầu gội ', sort: 'price_asc', minPrice: '100000', inStock: '1', rating: '4', brand: 'Tubu' });
    expect(productCalls()[0]![1]).toEqual({
      query: { page: 1, limit: 24, q: 'dầu gội', sort: 'price_asc', brand: 'Tubu', minPrice: 100000, inStock: 'true', minRating: 4 },
    });
    const key = (mocks.view.mock.calls[0]![0] as { initial: { urlKey: string } }).initial.urlKey;
    expect(key).toBe(new URLSearchParams({ q: 'dầu gội', brand: 'Tubu', minPrice: '100000', inStock: '1', rating: '4', sort: 'price_asc' }).toString());
  });

  it('?q lặp lại (mảng) lấy giá trị đầu; rỗng thì không gửi q', async () => {
    await render({ q: ['a', 'b'] });
    expect(productCalls().at(-1)![1]).toEqual({ query: { page: 1, limit: 24, q: 'a' } });
    await render({ q: '   ' });
    expect(productCalls().at(-1)![1]).toEqual({ query: { page: 1, limit: 24 } });
  });

  it('?page=2 tải đúng trang đó và báo startPage cho BrowseView; ?page rác về trang 1', async () => {
    catalog = () => pageOf([PRODUCT], 45, 2);
    await render({ page: '2' });
    expect(productCalls().at(-1)![1]).toEqual({ query: { page: 2, limit: 24 } });
    expect((mocks.view.mock.calls.at(-1)![0] as { initial: { startPage: number } }).initial.startPage).toBe(2);
    for (const page of ['abc', '0', '-3']) {
      await render({ page });
      expect(productCalls().at(-1)![1]).toEqual({ query: { page: 1, limit: 24 } });
    }
  });

  it('?page vượt trang cuối: chuyển về trang cuối giữ bộ lọc thay vì báo chưa có sản phẩm', async () => {
    catalog = () => pageOf([], 45, 9);
    await expect(render({ page: '9', brand: 'Tubu' })).rejects.toThrow('NEXT_REDIRECT /san-pham?brand=Tubu&page=2');
  });

  it('catalog thật sự rỗng: không chuyển hướng', async () => {
    catalog = () => pageOf([], 0);
    await render({});
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('API danh mục sản phẩm lỗi: vẫn dựng trang, BrowseView tự tải lại phía trình duyệt (initial = null)', async () => {
    catalog = () => {
      throw new Error('down');
    };
    await render({});
    expect((mocks.view.mock.calls[0]![0] as { initial: unknown }).initial).toBeNull();
  });

  it('API nhãn hoặc danh mục lỗi: bỏ phần đó, không làm hỏng trang', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/products') return pageOf([PRODUCT]);
      throw new Error('down');
    });
    await render({});
    const props = mocks.view.mock.calls[0]![0] as { brands: unknown; categories: unknown; initial: unknown };
    expect(props.brands).toBeUndefined();
    expect(props.categories).toBeUndefined();
    expect(props.initial).not.toBeNull();
  });
});

describe('BrowsePage — SEO', () => {
  it('trang gốc: tiêu đề riêng, canonical về /san-pham', async () => {
    const m = await generateMetadata({ searchParams: sp({}) });
    expect(m.title).toBe('Tất cả sản phẩm | Tubu Tree');
    expect(m.alternates).toEqual({ canonical: '/san-pham' });
  });

  it('kết quả tìm kiếm, danh mục, phân khúc và lọc/sắp xếp không cho công cụ tìm kiếm lập chỉ mục (vô hạn biến thể URL)', async () => {
    for (const o of [{ q: 'gội' }, { category: 'c-goi' }, { segment: 'eco' }, { minPrice: '1' }, { sort: 'newest' }, { inStock: '1' }, { rating: '4' }]) {
      expect(await generateMetadata({ searchParams: sp(o) })).toEqual({ robots: { index: false, follow: true } });
    }
  });

  it('trang phân trang và trang nhãn có tiêu đề + canonical riêng; nhãn không có thật thì noindex', async () => {
    const p2 = await generateMetadata({ searchParams: sp({ page: '2' }) });
    expect(p2.title).toBe('Sản phẩm sống xanh — Trang 2 | Tubu Tree');
    expect(p2.alternates).toEqual({ canonical: '/san-pham?page=2' });
    const brand = await generateMetadata({ searchParams: sp({ brand: 'Tubu' }) });
    expect(brand.title).toBe('Sản phẩm Tubu | Tubu Tree');
    expect(brand.robots).toBeUndefined();
    const fake = await generateMetadata({ searchParams: sp({ brand: 'khong-co' }) });
    expect(fake.robots).toEqual({ index: false, follow: true });
  });

  it('tham số theo dõi (utm, ref, s) không đổi canonical', async () => {
    const m = await generateMetadata({ searchParams: sp({ utm_source: 'zalo', ref: 'AN1', s: 'ctv-an' }) });
    expect(m.alternates).toEqual({ canonical: '/san-pham' });
    expect(m.robots).toBeUndefined();
  });
});
