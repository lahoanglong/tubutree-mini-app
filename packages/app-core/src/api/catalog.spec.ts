import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import {
  catalogParams,
  fetchBoughtTogether,
  fetchBrands,
  fetchCatalog,
  fetchCategories,
  fetchForYou,
  fetchProduct,
  fetchProducts,
  fetchProductsBySlugs,
  fetchRelated,
  suggestProducts,
  type PageResponse,
  type ProductCard,
} from './catalog';

const page = (n: number, ids: string[]): PageResponse<ProductCard> => ({
  data: ids.map((id) => ({ id }) as ProductCard),
  meta: { page: 1, limit: 30, total: n },
});

describe('catalog — hợp đồng gọi API', () => {
  it('đường dẫn, method, query của các hàm GET đơn', async () => {
    const { http, calls } = fakeHttp();
    await fetchProduct(http, 'sua-tam');
    await fetchBrands(http);
    await fetchRelated(http, 'sua-tam');
    await fetchForYou(http);
    await fetchBoughtTogether(http, 'sua-tam');
    await suggestProducts(http, 'sữa');
    await fetchCategories(http);
    expect(calls).toEqual([
      { method: 'get', path: '/products/sua-tam' },
      { method: 'get', path: '/brands' },
      { method: 'get', path: '/products/sua-tam/related' },
      { method: 'get', path: '/products/for-you' },
      { method: 'get', path: '/products/sua-tam/bought-together' },
      { method: 'get', path: '/search/suggest', opts: { query: { q: 'sữa' } } },
      { method: 'get', path: '/categories' },
    ]);
  });

  it('fetchProductsBySlugs: bỏ trùng, tối đa 20, rỗng thì không gọi', async () => {
    const { http, calls } = fakeHttp(() => page(0, ['a']));
    expect(await fetchProductsBySlugs(http, [])).toEqual([]);
    expect(calls).toHaveLength(0);
    const slugs = Array.from({ length: 25 }, (_, i) => `s${i % 22}`);
    await fetchProductsBySlugs(http, slugs);
    const q = calls[0]!.opts!.query!;
    expect(calls[0]).toMatchObject({ method: 'get', path: '/products' });
    expect(String(q.slugs).split(',')).toHaveLength(20);
    expect(q.limit).toBe(20);
  });

  it('fetchProducts một thương hiệu: một lời gọi GET /products với đúng params', async () => {
    const { http, calls } = fakeHttp(() => page(1, ['a']));
    await fetchProducts(http, { limit: 6, sort: 'newest' });
    await fetchProducts(http, { brand: 'tubu', page: 2 });
    expect(calls).toEqual([
      { method: 'get', path: '/products', opts: { query: { limit: 6, sort: 'newest' } } },
      { method: 'get', path: '/products', opts: { query: { brand: 'tubu', page: 2 } } },
    ]);
  });

  it('fetchProducts nhiều thương hiệu: trang đầu có dữ liệu thì trả luôn', async () => {
    const { http, calls } = fakeHttp(() => page(1, ['a']));
    const r = await fetchProducts(http, { brand: 'a,b' });
    expect(calls).toHaveLength(1);
    expect(r.data).toHaveLength(1);
  });

  it('fetchProducts nhiều thương hiệu: rỗng thì gọi từng brand từ trang 1, gộp, bỏ trùng, cắt theo offset', async () => {
    const { http, calls } = fakeHttp((c) => {
      const q = c.opts!.query!;
      if (q.brand === 'a,b') return page(0, []);
      return q.brand === 'a' ? page(2, ['1', '2']) : page(2, ['2', '3']);
    });
    const r = await fetchProducts(http, { brand: 'a,b', page: 1, limit: 2 });
    expect(calls.slice(1).map((c) => c.opts!.query)).toEqual([
      { brand: 'a', page: 1, limit: 4 },
      { brand: 'b', page: 1, limit: 4 },
    ]);
    expect(r.data.map((p) => p.id)).toEqual(['1', '2']);
    expect(r.meta).toEqual({ page: 1, limit: 2, total: 3 });
  });

  it('fetchProducts nhiều thương hiệu: một brand lỗi thì coi như rỗng', async () => {
    const { http } = fakeHttp((c) => {
      const q = c.opts!.query!;
      if (q.brand === 'a,b') return page(0, []);
      if (q.brand === 'a') throw new Error('boom');
      return page(1, ['3']);
    });
    const r = await fetchProducts(http, { brand: 'a,b' });
    expect(r.data.map((p) => p.id)).toEqual(['3']);
  });

  it('catalogParams: chỉ gửi tham số có giá trị; q được trim; inStock=true', () => {
    expect(catalogParams({ page: 1, limit: 30 })).toEqual({ page: 1, limit: 30 });
    expect(
      catalogParams({ page: 2, limit: 10, q: '  sữa ', sort: 'newest', brand: 'a,b', category: 'c', segment: 's', minPrice: 0, maxPrice: 9, inStock: true, minRating: 4 }),
    ).toEqual({ page: 2, limit: 10, q: 'sữa', sort: 'newest', brand: 'a,b', category: 'c', segment: 's', minPrice: 0, maxPrice: 9, inStock: 'true', minRating: 4 });
    expect(catalogParams({ page: 1, limit: 1, inStock: false })).not.toHaveProperty('inStock');
  });

  it('fetchCatalog: thành công thì filtersIgnored=false', async () => {
    const { http } = fakeHttp(() => page(0, []));
    expect((await fetchCatalog(http, { page: 1, limit: 5, minPrice: 1 })).filtersIgnored).toBe(false);
  });

  it('fetchCatalog: 400 khi có tham số mới → gọi lại không kèm chúng, filtersIgnored=true (lỗi dạng ApiError và axios)', async () => {
    for (const err of [Object.assign(new Error('x'), { status: 400 }), Object.assign(new Error('x'), { response: { status: 400 } })]) {
      let n = 0;
      const { http, calls } = fakeHttp(() => {
        if (n++ === 0) throw err;
        return page(0, []);
      });
      const r = await fetchCatalog(http, { page: 1, limit: 5, minPrice: 1, maxPrice: 2, inStock: true, minRating: 3, q: 'a' });
      expect(r.filtersIgnored).toBe(true);
      expect(calls[1]!.opts!.query).toEqual({ page: 1, limit: 5, q: 'a' });
    }
  });

  it('fetchCatalog: 400 mà không có tham số mới, hoặc 500, thì ném lại', async () => {
    const mk = (status: number) => fakeHttp(() => { throw Object.assign(new Error('x'), { status }); }).http;
    await expect(fetchCatalog(mk(400), { page: 1, limit: 5 })).rejects.toThrow();
    await expect(fetchCatalog(mk(500), { page: 1, limit: 5, minPrice: 1 })).rejects.toThrow();
  });
});
