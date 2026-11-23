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
    expect(m.title).toBe('Bán chạy nhất');
    expect(m.alternates?.canonical).toBe('/ban-chay');
    expect(m.openGraph).toMatchObject({ siteName: 'Tubu Tree', locale: 'vi_VN', url: '/ban-chay', title: 'Bán chạy nhất — Tubu Tree', images: [expect.objectContaining({ url: '/opengraph-image.png' })] });
    expect(m.robots).toBeUndefined();
  });

  it('?category= là noindex,follow và KHÔNG có canonical (không bao giờ noindex kèm canonical sang URL khác)', async () => {
    for (const q of [{ category: 'c-goi' }, { category: 'c-goi', page: '3' }]) {
      const m = await generateMetadata({ searchParams: sp(q) });
      expect(m.robots).toEqual({ index: false, follow: true });
      expect(m.alternates).toBeUndefined();
      expect((m.openGraph as { url?: string }).url).toBeUndefined();
    }
  });

  it('?page=N (N>=2) được lập chỉ mục, canonical tự trỏ về chính nó, tiêu đề có số trang', async () => {
    const m = await generateMetadata({ searchParams: sp({ page: '2' }) });
    expect(m.robots).toBeUndefined();
    expect(m.alternates?.canonical).toBe('/ban-chay?page=2');
    expect(m.title).toBe('Bán chạy nhất — Trang 2');
  });

  it('?page=1, số lạ và tham số theo dõi chuẩn hoá về /ban-chay, được lập chỉ mục', async () => {
    for (const q of [{ page: '1' }, { page: 'abc' }, { utm_source: 'zalo' }]) {
      const m = await generateMetadata({ searchParams: sp(q) });
      expect(m.robots).toBeUndefined();
      expect(m.alternates?.canonical).toBe('/ban-chay');
    }
  });
});

describe('/ban-chay — og/twitter và JSON-LD CollectionPage (w21-01)', () => {
  const ldOf = (html: string) => {
    const box = document.createElement('div');
    box.innerHTML = html;
    return Array.from(box.querySelectorAll('script[type="application/ld+json"]')).map((x) => JSON.parse(x.textContent!));
  };

  it('trang lập chỉ mục có thẻ twitter cùng tiêu đề và mô tả với og', async () => {
    const m = await generateMetadata({ searchParams: sp({ page: '2' }) });
    expect(m.openGraph).toMatchObject({ url: '/ban-chay?page=2', title: 'Bán chạy nhất — Trang 2 — Tubu Tree', description: m.description });
    expect(m.twitter).toMatchObject({ card: 'summary_large_image', title: 'Bán chạy nhất — Trang 2 — Tubu Tree', description: m.description });
  });

  it('trang trơn: một @graph CollectionPage (ItemList đúng các món trong HTML) + BreadcrumbList Trang chủ › Bán chạy nhất', async () => {
    catalog = () => pageOf([PRODUCT, { ...PRODUCT, id: 'p2', slug: 'sua-tam', name: 'Sữa tắm' }], 2);
    const [ld] = ldOf(await render({}));
    const [page, crumbs] = ld['@graph'];
    expect(page).toMatchObject({ '@type': 'CollectionPage', url: 'https://app.tubutree.com/ban-chay', name: 'Bán chạy nhất' });
    expect(page.mainEntity.itemListElement.map((i: { position: number; url: string }) => [i.position, i.url])).toEqual([
      [1, 'https://app.tubutree.com/san-pham/dau-goi'],
      [2, 'https://app.tubutree.com/san-pham/sua-tam'],
    ]);
    expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Trang chủ', 'Bán chạy nhất']);
  });

  it('?page=2: vị trí nối tiếp trang trước (21…); ?category= (noindex) không khai JSON-LD', async () => {
    catalog = () => pageOf([PRODUCT], 21, 2);
    const [ld] = ldOf(await render({ page: '2' }));
    expect(ld['@graph'][0].mainEntity.itemListElement[0].position).toBe(21);
    expect(ld['@graph'][0].url).toBe('https://app.tubutree.com/ban-chay?page=2');
    catalog = () => pageOf([PRODUCT], 1);
    expect(ldOf(await render({ category: 'c-goi' }))).toEqual([]);
  });

  it('kệ "Tubu chọn cho bạn": ItemList chỉ gồm món ghim mà view vẽ, vị trí từ 1, không kèm dòng xếp hạng phía sau', async () => {
    const pin = (id: string) => ({ ...PRODUCT, id, slug: id, curated: true });
    catalog = () => pageOf([pin('ghim-a'), pin('ghim-b'), { ...PRODUCT, id: 'p3', slug: 'xep-hang' }], 3);
    const [ld] = ldOf(await render({}));
    expect(ld['@graph'][0].mainEntity.itemListElement.map((i: { position: number; url: string }) => [i.position, i.url])).toEqual([
      [1, 'https://app.tubutree.com/san-pham/ghim-a'],
      [2, 'https://app.tubutree.com/san-pham/ghim-b'],
    ]);
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
    expect(productCalls()).toEqual([
      { sort: 'best_seller_30d', limit: 20, page: 1, category: 'da-xoa' },
      { sort: 'best_seller_30d', limit: 20, page: 1 },
    ]);
    expect(viewProps().initial).toMatchObject({ category: undefined });
    expect(viewProps().initial?.page.data).toHaveLength(1); // vẫn ra danh sách "Tất cả", không rỗng
  });

  it('gọi cây danh mục và danh sách song song; category hợp lệ thì chỉ một lần gọi danh sách', async () => {
    let productsStarted!: () => void;
    const started = new Promise<void>((r) => (productsStarted = r));
    const baseCatalog = catalog;
    catalog = (q) => {
      productsStarted();
      return baseCatalog(q);
    };
    // Cây chỉ trả về sau khi danh sách đã được gọi: gọi nối tiếp thì treo.
    categories = () => started.then(() => CATEGORIES);
    await render({ category: 'c-goi' });
    expect(productCalls()).toEqual([{ sort: 'best_seller_30d', limit: 20, page: 1, category: 'c-goi' }]);
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
