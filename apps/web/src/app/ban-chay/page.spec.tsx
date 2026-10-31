// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Trang server của /ban-chay: tải sẵn cây danh mục rồi trang đầu đúng phạm vi (id lạ không lọc) cho crawler, giữ SEO (chỉ trang trơn được
// lập chỉ mục), rồi BestSellersView tiếp quản.

const mocks = vi.hoisted(() => ({ get: vi.fn(), redirect: vi.fn(), view: vi.fn() }));
vi.mock('@/lib/core-http-server', () => ({ createServerHttp: () => ({ get: mocks.get }) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('./best-sellers-view', () => ({
  default: (props: unknown) => {
    mocks.view(props);
    return <div data-testid="best-sellers-view" />;
  },
}));

import BestSellersPage, { generateMetadata } from './page';

const PRODUCT = { id: 'p1', slug: 'dau-goi', brand: 'Tubu', name: 'Dầu gội bồ kết', thumbnail: null, basePrice: 200000, salePrice: null, isFeatured: false, inStock: true };
const CATEGORIES = [
  { id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4, children: [] },
  { id: 'c-trong', parentId: null, name: 'Trống', slug: 'trong', image: null, sortOrder: 2, productCount: 0, children: [] },
];
const pageOf = (data: unknown[], total = data.length, page = 1) => ({ data, meta: { page, limit: 20, total } });

let catalog: (q: Record<string, unknown> | undefined) => unknown;
let categories: () => unknown;
beforeEach(() => {
  mocks.redirect.mockReset();
  mocks.view.mockReset();
  catalog = () => pageOf([PRODUCT], 1);
  categories = () => CATEGORIES;
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: Record<string, unknown> }) => {
    if (path === '/products') return catalog(opts?.query);
    if (path === '/categories') return categories();
    throw new Error(`đường dẫn lạ ${path}`);
  });
});

const sp = (o: Record<string, string | string[] | undefined>) => Promise.resolve(o);
const render = async (o: Record<string, string | string[] | undefined>) => renderToStaticMarkup(await BestSellersPage({ searchParams: sp(o) }));
const productCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/products').map(([, o]) => (o as { query: Record<string, unknown> }).query);
const viewProps = () => mocks.view.mock.calls[0]![0] as { initial: { category: string | undefined; startPage: number; page: { data: unknown[] } } | null; categories: unknown };

describe('generateMetadata', () => {
  it('trang trơn được lập chỉ mục, canonical /ban-chay', async () => {
    const m = await generateMetadata({ searchParams: sp({}) });
    expect(m.title).toBe('Bán chạy nhất — Tubu Tree');
    expect(m.alternates?.canonical).toBe('/ban-chay');
    expect(m.robots).toBeUndefined();
  });

  it('có category hoặc page từ 2 là noindex (cùng sản phẩm, chỉ khác lối vào); tham số theo dõi thì không', async () => {
    expect((await generateMetadata({ searchParams: sp({ category: 'c-goi' }) })).robots).toEqual({ index: false, follow: true });
    expect((await generateMetadata({ searchParams: sp({ page: '2' }) })).robots).toEqual({ index: false, follow: true });
    expect((await generateMetadata({ searchParams: sp({ utm_source: 'zalo' }) })).robots).toBeUndefined();
  });
});

describe('BestSellersPage (server)', () => {
  it('không tham số: tải cây danh mục rồi trang 1 (sort 30 ngày, 20 món), không category', async () => {
    await render({});
    expect(productCalls()).toEqual([{ sort: 'best_seller_30d', limit: 20, page: 1 }]);
    expect(viewProps().categories).toEqual(CATEGORIES);
    expect(viewProps().initial).toMatchObject({ category: undefined, startPage: 1 });
  });

  it('category là danh mục gốc có thật: lọc theo nó; id lạ hoặc danh mục con thì không lọc', async () => {
    await render({ category: 'c-goi' });
    expect(productCalls().at(-1)).toMatchObject({ category: 'c-goi' });
    expect(viewProps().initial).toMatchObject({ category: 'c-goi' });

    mocks.get.mockClear();
    mocks.view.mockClear();
    await render({ category: 'da-xoa' });
    expect(productCalls().at(-1)).toEqual({ sort: 'best_seller_30d', limit: 20, page: 1 });
    expect(viewProps().initial).toMatchObject({ category: undefined });
  });

  it('?page=2: trang 2; hạng sẽ tiếp nối ở view (startPage=2)', async () => {
    catalog = () => pageOf([PRODUCT], 45, 2);
    await render({ page: '2' });
    expect(productCalls()).toEqual([{ sort: 'best_seller_30d', limit: 20, page: 2 }]);
    expect(viewProps().initial).toMatchObject({ startPage: 2 });
  });

  it('?page= vượt trang cuối: chuyển về trang cuối', async () => {
    catalog = () => ({ data: [], meta: { page: 9, limit: 20, total: 45 } });
    await expect(render({ page: '9' })).rejects.toThrow('NEXT_REDIRECT /ban-chay?page=3');
  });

  it('cây danh mục lỗi: vẫn dựng trang theo tham số URL, categories bỏ trống để client tự thử', async () => {
    categories = () => {
      throw new Error('down');
    };
    await render({ category: 'c-goi' });
    expect(productCalls().at(-1)).toMatchObject({ category: 'c-goi' });
    expect(viewProps().categories).toBeUndefined();
  });

  it('danh sách lỗi: view vẫn dựng, không có initial (client tự tải)', async () => {
    catalog = () => {
      throw new Error('down');
    };
    await render({});
    expect(viewProps().initial).toBeNull();
  });
});
