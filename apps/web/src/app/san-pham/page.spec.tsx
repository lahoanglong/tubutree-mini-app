import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// @vitest-environment jsdom
// Danh mục + tìm kiếm chuyển từ "/" sang /san-pham (00-ma-tran dòng 2): trang server tải sẵn dữ liệu đầu cho đúng URL (gốc là hub:
// kệ Bán chạy nhất, KHÔNG tải danh sách; còn lại là danh sách đầu), giữ SEO (canonical, noindex khi có q/lọc/all) rồi BrowseView tiếp quản.

const mocks = vi.hoisted(() => ({ get: vi.fn(), redirect: vi.fn(), view: vi.fn() }));
vi.mock('@/lib/core-http-server', () => ({ createServerHttp: () => ({ get: mocks.get }) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('@/components/catalog/browse-view', () => ({
  default: (props: unknown) => {
    mocks.view(props);
    return <div data-testid="browse-view" />;
  },
}));

import BrowsePage, { generateMetadata } from './page';

const PRODUCT = { id: 'p1', slug: 'dau-goi', brand: 'Tubu', name: 'Dầu gội bồ kết', thumbnail: null, basePrice: 200000, salePrice: null, isFeatured: false, inStock: true };
const CATEGORIES = [{ id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4 }];
const BRANDS = [{ brand: 'Tubu', count: 3, slug: 'tubu-xanh' }, { brand: 'A&B', count: 1 }];
const pageOf = (data: unknown[], total = data.length, page = 1) => ({ data, meta: { page, limit: 20, total } });

let catalog: () => unknown;
let bestSellers: () => unknown;
beforeEach(() => {
  mocks.redirect.mockReset();
  mocks.view.mockReset();
  catalog = () => pageOf([PRODUCT]);
  bestSellers = () => pageOf([PRODUCT, { ...PRODUCT, id: 'p2', slug: 'nrc' }, { ...PRODUCT, id: 'p3', slug: 'xp' }]);
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: Record<string, unknown> }) => {
    if (path === '/products') return opts?.query?.sort === 'best_seller_30d' ? bestSellers() : catalog();
    if (path === '/brands') return BRANDS;
    if (path === '/categories') return CATEGORIES;
    throw new Error(`đường dẫn lạ ${path}`);
  });
});

const sp = (o: Record<string, string | string[] | undefined>) => Promise.resolve(o);
const render = async (o: Record<string, string | string[] | undefined>) => renderToStaticMarkup(await BrowsePage({ searchParams: sp(o) }));
const productCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/products');

describe('BrowsePage — hub ở gốc', () => {
  it('không có tham số: là hub, KHÔNG gọi danh sách; chỉ tải kệ Bán chạy nhất (10 món, sort=best_seller_30d) cùng nhãn + danh mục', async () => {
    await render({});
    expect(productCalls()).toEqual([['/products', { query: { sort: 'best_seller_30d', limit: 10 } }]]);
    const props = mocks.view.mock.calls[0]![0] as { initial: unknown; bestSellers: unknown[]; brands: unknown; categories: unknown };
    expect(props.initial).toBeNull();
    expect(props.bestSellers).toHaveLength(3);
    expect(props.brands).toEqual(BRANDS);
    expect(props.categories).toEqual(CATEGORIES);
  });

  it('tham số theo dõi (utm, ref, s) không đưa trang ra khỏi hub', async () => {
    await render({ utm_source: 'zalo', ref: 'AN1' });
    expect(productCalls().every(([, o]) => (o as { query: { sort?: string } }).query.sort === 'best_seller_30d')).toBe(true);
  });

  it('kệ Bán chạy nhất lỗi: hub vẫn dựng, bestSellers bỏ trống để client tự thử', async () => {
    bestSellers = () => {
      throw new Error('down');
    };
    await render({});
    expect((mocks.view.mock.calls[0]![0] as { bestSellers: unknown }).bestSellers).toBeUndefined();
  });

  it('?page=2 ở gốc là danh sách, không phải hub: tải trang 2, không tải kệ Bán chạy nhất', async () => {
    catalog = () => pageOf([PRODUCT], 45, 2);
    await render({ page: '2' });
    expect(productCalls()).toEqual([['/products', { query: { page: 2, limit: 20 } }]]);
  });
});

describe('BrowsePage — dữ liệu ban đầu của danh sách', () => {
  it('main không ghép max-md:pt với sm:py (sm: thắng ở 640-767px)', async () => {
    const cls = /<main[^>]*class="([^"]*)"/.exec(await render({}))![1]!;
    expect(cls).not.toMatch(/(^|\s)sm:py-/);
  });

  it('?all=1: gọi GET /products trang 1, 20 sản phẩm, và giao danh sách + nhãn + danh mục cho BrowseView', async () => {
    await render({ all: '1' });
    expect(productCalls()).toEqual([['/products', { query: { page: 1, limit: 20 } }]]);
    const props = mocks.view.mock.calls[0]![0] as { initial: { urlKey: string; startPage: number; page: unknown }; brands: unknown; categories: unknown; bestSellers: unknown };
    expect(props.initial).toEqual({ urlKey: 'all=1', startPage: 1, page: { ...pageOf([PRODUCT]), filtersIgnored: false } });
    expect(props.bestSellers).toBeUndefined();
    expect(props.brands).toEqual(BRANDS);
    expect(props.categories).toEqual(CATEGORIES);
  });

  it('?q= cắt khoảng trắng đầu cuối, ?sort/?minPrice/?inStock/?rating/?brand đi đúng tham số API như Mini App; urlKey là khoá chuẩn', async () => {
    await render({ q: '  dầu gội ', sort: 'price_asc', minPrice: '100000', inStock: '1', rating: '4', brand: 'Tubu' });
    expect(productCalls()[0]![1]).toEqual({
      query: { page: 1, limit: 20, q: 'dầu gội', sort: 'price_asc', brand: 'Tubu', minPrice: 100000, inStock: 'true', minRating: 4 },
    });
    const key = (mocks.view.mock.calls[0]![0] as { initial: { urlKey: string } }).initial.urlKey;
    expect(key).toBe(new URLSearchParams({ q: 'dầu gội', brand: 'Tubu', minPrice: '100000', inStock: '1', rating: '4', sort: 'price_asc' }).toString());
  });

  it('?q lặp lại (mảng) lấy giá trị đầu; rỗng thì không gửi q', async () => {
    await render({ q: ['a', 'b'] });
    expect(productCalls().at(-1)![1]).toEqual({ query: { page: 1, limit: 20, q: 'a' } });
    await render({ q: '   ', all: '1' });
    expect(productCalls().at(-1)![1]).toEqual({ query: { page: 1, limit: 20 } });
  });

  it('?page=2 tải đúng trang đó và báo startPage cho BrowseView; ?page rác về trang 1', async () => {
    catalog = () => pageOf([PRODUCT], 45, 2);
    await render({ page: '2' });
    expect(productCalls().at(-1)![1]).toEqual({ query: { page: 2, limit: 20 } });
    expect((mocks.view.mock.calls.at(-1)![0] as { initial: { startPage: number } }).initial.startPage).toBe(2);
    for (const page of ['abc', '0', '-3']) {
      await render({ page, all: '1' });
      expect(productCalls().at(-1)![1]).toEqual({ query: { page: 1, limit: 20 } });
    }
  });

  it('?page vượt trang cuối: chuyển về trang cuối giữ bộ lọc thay vì báo chưa có sản phẩm', async () => {
    catalog = () => pageOf([], 45, 9);
    await expect(render({ page: '9', brand: 'Tubu' })).rejects.toThrow('NEXT_REDIRECT /san-pham?brand=Tubu&page=3');
  });

  it('catalog thật sự rỗng: không chuyển hướng', async () => {
    catalog = () => pageOf([], 0);
    await render({ all: '1' });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('API danh mục sản phẩm lỗi: vẫn dựng trang, BrowseView tự tải lại phía trình duyệt (initial = null)', async () => {
    catalog = () => {
      throw new Error('down');
    };
    await render({ all: '1' });
    expect((mocks.view.mock.calls[0]![0] as { initial: unknown }).initial).toBeNull();
  });

  it('API nhãn hoặc danh mục lỗi: bỏ phần đó, không làm hỏng trang', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/products') return pageOf([PRODUCT]);
      throw new Error('down');
    });
    await render({ all: '1' });
    const props = mocks.view.mock.calls[0]![0] as { brands: unknown; categories: unknown; initial: unknown };
    expect(props.brands).toBeUndefined();
    expect(props.categories).toBeUndefined();
    expect(props.initial).not.toBeNull();
  });
});

describe('BrowsePage — SEO', () => {
  it('trang gốc: tiêu đề riêng, canonical về /san-pham', async () => {
    const m = await generateMetadata({ searchParams: sp({}) });
    expect(m.title).toBe('Tất cả sản phẩm');
    expect(m.alternates).toEqual({ canonical: '/san-pham' });
  });

  it('mọi trạng thái được lập chỉ mục đều có mô tả (trước đây /san-pham thiếu meta description)', async () => {
    for (const o of [{}, { page: '2' }, { brand: 'Tubu' }, { category: 'c-goi' }, { utm_source: 'zalo' }]) {
      const m = await generateMetadata({ searchParams: sp(o) });
      expect(typeof m.description, JSON.stringify(o)).toBe('string');
      expect((m.description as string).length, JSON.stringify(o)).toBeGreaterThan(40);
    }
  });

  it('?category=<id có thật> đứng một mình: tiêu đề là tên danh mục, canonical riêng, cho lập chỉ mục', async () => {
    const m = await generateMetadata({ searchParams: sp({ category: 'c-goi' }) });
    expect(m.title).toBe('Dầu gội');
    expect(m.alternates).toEqual({ canonical: '/san-pham?category=c-goi' });
    expect(m.robots).toBeUndefined();
    const tracked = await generateMetadata({ searchParams: sp({ category: 'c-goi', utm_source: 'zalo' }) });
    expect(tracked.alternates).toEqual({ canonical: '/san-pham?category=c-goi' });
  });

  it('?category= không có trong cây (id lạ) hoặc kèm tham số khác → noindex', async () => {
    expect(await generateMetadata({ searchParams: sp({ category: 'khong-co' }) })).toEqual({ robots: { index: false, follow: true } });
    for (const o of [{ category: 'c-goi', brand: 'Tubu' }, { category: 'c-goi', page: '2' }, { category: 'c-goi', sort: 'newest' }, { category: 'c-goi', q: 'gội' }, { category: '' }]) {
      expect(await generateMetadata({ searchParams: sp(o) }), JSON.stringify(o)).toEqual({ robots: { index: false, follow: true } });
    }
  });

  it('?category= hợp lệ nhưng API danh mục lỗi: ném lỗi (giữ bản ISR cũ), không trả 200 + noindex làm URL rớt khỏi chỉ mục', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/categories') throw new Error('API lỗi');
      return [];
    });
    await expect(generateMetadata({ searchParams: sp({ category: 'c-goi' }) })).rejects.toThrow('API lỗi');
  });

  it('BreadcrumbList JSON-LD ở trạng thái nhãn và danh mục (theo vệt breadcrumb hiển thị), không có ở hub hay trạng thái noindex', async () => {
    const ld = (html: string) => Array.from(html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)).map((m) => JSON.parse(m[1]!));
    const brandLd = ld(await render({ brand: 'Tubu' }))[0];
    expect(brandLd.itemListElement.map((i: { name: string; item: string }) => [i.name, i.item])).toEqual([
      ['Trang chủ', 'https://app.tubutree.com/'],
      ['Danh mục', 'https://app.tubutree.com/san-pham'],
      ['Tubu', 'https://app.tubutree.com/san-pham?brand=Tubu'],
    ]);
    const catLd = ld(await render({ category: 'c-goi' }))[0];
    expect(catLd.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Trang chủ', 'Danh mục', 'Dầu gội']);
    expect(ld(await render({}))).toEqual([]);
    expect(ld(await render({ brand: 'khong-co' }))).toEqual([]);
    expect(ld(await render({ category: 'c-goi', sort: 'newest' }))).toEqual([]);
  });

  it('kết quả tìm kiếm, phân khúc và lọc/sắp xếp không cho công cụ tìm kiếm lập chỉ mục (vô hạn biến thể URL)', async () => {
    for (const o of [{ q: 'gội' }, { segment: 'eco' }, { minPrice: '1' }, { sort: 'newest' }, { inStock: '1' }, { rating: '4' }, { all: '1' }]) {
      expect(await generateMetadata({ searchParams: sp(o) })).toEqual({ robots: { index: false, follow: true } });
    }
  });

  it('danh sách gốc từ trang 2 noindex như ?all=1 (trang 1 của danh sách); trang nhãn có tiêu đề + canonical riêng; nhãn không có thật thì noindex', async () => {
    const p2 = await generateMetadata({ searchParams: sp({ page: '2' }) });
    expect(p2.title).toBe('Sản phẩm sống xanh — Trang 2');
    expect(p2.robots).toEqual({ index: false, follow: true });
    expect(p2.alternates).toBeUndefined();
    const brandP2 = await generateMetadata({ searchParams: sp({ brand: 'Tubu', page: '2' }) });
    expect(brandP2.alternates).toEqual({ canonical: '/san-pham?brand=Tubu&page=2' });
    expect(brandP2.robots).toBeUndefined();
    const brand = await generateMetadata({ searchParams: sp({ brand: 'Tubu' }) });
    expect(brand.title).toBe('Sản phẩm Tubu');
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
