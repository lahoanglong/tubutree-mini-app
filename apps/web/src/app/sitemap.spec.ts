import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getProducts: vi.fn(), getStorefrontList: vi.fn(), getBrands: vi.fn(), getLegalDoc: vi.fn(), getCategories: vi.fn() }));
const flags = vi.hoisted(() => ({ cashback: false }));
vi.mock('@tubutree/app-core/features', () => ({
  get CASHBACK_ENABLED() {
    return flags.cashback;
  },
}));
const routeMocks = vi.hoisted(() => ({ publicStaticRoutes: vi.fn(() => ['/']) }));
vi.mock('@/lib/route-map', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/route-map')>()),
  publicStaticRoutes: routeMocks.publicStaticRoutes,
}));
const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-http-server')>()),
  createServerHttp: () => ({ get: http.get }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getProducts: mocks.getProducts,
  getStorefrontList: mocks.getStorefrontList,
  getBrands: mocks.getBrands,
  getLegalDoc: mocks.getLegalDoc,
  getCategories: mocks.getCategories,
}));

import sitemap from './sitemap';
import { ApiNotFoundError } from '@/lib/core-http-server';
import { ApiUnavailableError } from '@/lib/api';

// API chặn limit > 100 (apps/api/src/common/pagination.ts): gọi limit lớn hơn trả 400 và sitemap 500.
const API_MAX_LIMIT = 100;
const products = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ slug: `sp-${from + i}` }));
const entryOf = (out: Awaited<ReturnType<typeof sitemap>>, suffix: string) => out.find((e) => e.url.endsWith(suffix));
const productUrls = (out: Awaited<ReturnType<typeof sitemap>>) => out.filter((e) => e.url.includes('/san-pham/'));

beforeEach(() => {
  mocks.getProducts.mockReset().mockResolvedValue([]);
  mocks.getStorefrontList.mockReset().mockResolvedValue([]);
  mocks.getBrands.mockReset().mockResolvedValue([]);
  mocks.getLegalDoc.mockReset().mockResolvedValue({ content: null, vars: {} });
  mocks.getCategories.mockReset().mockResolvedValue([]);
  http.get.mockReset().mockResolvedValue([]);
});

describe('sitemap', () => {
  it('nộp mọi danh mục còn sản phẩm đang bán (cả danh mục con) theo đúng dạng canonical của trang danh mục; danh mục rỗng hay thiếu số đếm thì bỏ', async () => {
    mocks.getCategories.mockResolvedValue([
      { id: 'cat-tay-rua', name: 'Tẩy rửa', slug: 'tay-rua', sortOrder: 1, productCount: 40, children: [
        { id: 'cat-nuoc-giat', name: 'Nước giặt', slug: 'nuoc-giat', sortOrder: 1, productCount: 12 },
        { id: 'cat-rong', name: 'Rỗng', slug: 'rong', sortOrder: 2, productCount: 0 },
      ] },
      { id: 'cat-cu', name: 'API cũ', slug: 'cu', sortOrder: 2 },
      { id: 'cat-tay-rua', name: 'Lặp vòng', slug: 'lap', sortOrder: 3, productCount: 5 },
    ]);
    const out = await sitemap();
    const urls = out.filter((e) => e.url.includes('?category=')).map((e) => e.url);
    expect(urls).toEqual(['https://app.tubutree.com/san-pham?category=cat-tay-rua', 'https://app.tubutree.com/san-pham?category=cat-nuoc-giat']);
    const { browseCanonicalPath } = await import('@/lib/home-seo');
    expect(urls[1]).toBe(`https://app.tubutree.com${browseCanonicalPath({ category: { id: 'cat-nuoc-giat', name: 'Nước giặt' } })}`);
  });

  it('không nộp trang riêng tư (giỏ, thanh toán, theo dõi đơn, quản trị) dù dùng route map thật', async () => {
    const actual = await vi.importActual<typeof import('@/lib/route-map')>('@/lib/route-map');
    routeMocks.publicStaticRoutes.mockReturnValueOnce(actual.publicStaticRoutes());
    const paths = (await sitemap()).map((e) => new URL(e.url).pathname);
    for (const p of ['/gio-hang', '/thanh-toan', '/don', '/admin', '/tai-khoan', '/dang-nhap', '/merchant']) {
      expect(paths.filter((x) => x === p || x.startsWith(`${p}/`))).toEqual([]);
    }
    for (const p of ['/doi-rac', '/doi-rac/quy-dinh', '/vuon-xanh', '/gioi-thieu', '/san-pham']) expect(paths).toContain(p);
  });

  it('thêm route công khai tĩnh của route map, trang chủ không bị lặp', async () => {
    routeMocks.publicStaticRoutes.mockReturnValueOnce(['/', '/gioi-thieu']);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://app.tubutree.com/gioi-thieu');
    expect(urls.filter((u) => u === 'https://app.tubutree.com/')).toHaveLength(1);
  });

  it('không nộp /ds-gallery: trang dev trả 404 khi production (dùng route map thật)', async () => {
    const actual = await vi.importActual<typeof import('@/lib/route-map')>('@/lib/route-map');
    routeMocks.publicStaticRoutes.mockReturnValueOnce(actual.publicStaticRoutes());
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://app.tubutree.com/gioi-thieu');
    expect(urls.filter((u) => u.includes('ds-gallery'))).toEqual([]);
  });

  it('nộp /bo-qua-tang (trang Bộ quà tặng & combo khởi đầu, lập chỉ mục) theo route map thật', async () => {
    const actual = await vi.importActual<typeof import('@/lib/route-map')>('@/lib/route-map');
    routeMocks.publicStaticRoutes.mockReturnValueOnce(actual.publicStaticRoutes());
    const entry = (await sitemap()).find((e) => e.url === 'https://app.tubutree.com/bo-qua-tang');
    expect(entry).toMatchObject({ changeFrequency: 'weekly', priority: 0.6 });
  });

  it('không nộp /uu-dai và /ma-giam-gia: hai trang công khai nhưng noindex (dùng route map thật)', async () => {
    const actual = await vi.importActual<typeof import('@/lib/route-map')>('@/lib/route-map');
    routeMocks.publicStaticRoutes.mockReturnValueOnce([...actual.publicStaticRoutes(), '/uu-dai', '/ma-giam-gia']);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://app.tubutree.com/gioi-thieu');
    expect(urls).not.toContain('https://app.tubutree.com/uu-dai');
    expect(urls).not.toContain('https://app.tubutree.com/ma-giam-gia');
  });

  it('/hoan-tien chỉ vào sitemap khi CASHBACK_ENABLED bật, vì trang đang noindex khi cờ tắt', async () => {
    routeMocks.publicStaticRoutes.mockReturnValue(['/', '/hoan-tien']);
    try {
      flags.cashback = false;
      expect((await sitemap()).map((e) => e.url)).not.toContain('https://app.tubutree.com/hoan-tien');
      flags.cashback = true;
      expect((await sitemap()).map((e) => e.url)).toContain('https://app.tubutree.com/hoan-tien');
    } finally {
      routeMocks.publicStaticRoutes.mockImplementation(() => ['/']);
    }
  });

  it('thêm /brand/<slug> cho nhãn đã công khai, bỏ nhãn không có slug', async () => {
    mocks.getBrands.mockResolvedValue([{ brand: 'A', count: 2, slug: 'nhan-a' }, { brand: 'B', count: 1, slug: null }, { brand: 'C', count: 1 }]);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://app.tubutree.com/brand/nhan-a');
    expect(urls.filter((u) => u.includes('/brand/'))).toHaveLength(1);
  });

  it('chỉ nộp trang chính sách đã có nội dung duyệt; bản nháp (content null) thì không', async () => {
    mocks.getLegalDoc.mockImplementation(async (slug: string) => ({ content: slug === 'doi-tra' || slug === 'bao-mat' ? '# nội dung' : null, vars: {} }));
    const urls = (await sitemap()).map((e) => e.url).filter((u) => u.includes('/chinh-sach/'));
    expect(urls.sort()).toEqual(['https://app.tubutree.com/chinh-sach/bao-mat', 'https://app.tubutree.com/chinh-sach/doi-tra']);
  });

  it('nhãn hoặc chính sách lỗi thì ném lỗi, không nuốt', async () => {
    mocks.getBrands.mockRejectedValueOnce(new Error('brands lỗi'));
    await expect(sitemap()).rejects.toThrow('brands lỗi');
    mocks.getLegalDoc.mockRejectedValueOnce(new Error('legal lỗi'));
    await expect(sitemap()).rejects.toThrow('legal lỗi');
  });

  it('không bao giờ xin limit vượt trần của API', async () => {
    await sitemap();
    for (const [params] of mocks.getProducts.mock.calls) {
      expect(Number(params.limit)).toBeLessThanOrEqual(API_MAX_LIMIT);
    }
  });

  it('phân trang tới khi gặp trang ngắn: 100 + 30 sản phẩm ra đủ 130 URL', async () => {
    mocks.getProducts.mockResolvedValueOnce(products(0, 100)).mockResolvedValueOnce(products(100, 30));
    const out = await sitemap();
    expect(productUrls(out)).toHaveLength(130);
    expect(mocks.getProducts.mock.calls.map(([p]) => p.page)).toEqual(['1', '2']);
  });

  it('dừng ở trần số trang dù API vẫn trả trang đầy', async () => {
    mocks.getProducts.mockImplementation(async ({ page }: { page: string }) => products((Number(page) - 1) * 100, 100));
    const out = await sitemap();
    expect(mocks.getProducts).toHaveBeenCalledTimes(5);
    expect(productUrls(out)).toHaveLength(500);
  });

  it('API lỗi thì ném lỗi, không trả sitemap rút gọn', async () => {
    mocks.getProducts.mockRejectedValue(new Error('API /products không sẵn sàng'));
    await expect(sitemap()).rejects.toThrow('không sẵn sàng');
  });
});

describe('sitemap lastmod', () => {
  it('sản phẩm KHÔNG có lastModified dù API trả updatedAt: ngày đó bị sync đêm đẩy tiến nên không phản ánh sửa đổi thật', async () => {
    mocks.getProducts.mockResolvedValueOnce([{ slug: 'sp-a', updatedAt: '2026-11-02T08:30:00.000Z' }, { slug: 'sp-b' }]);
    const out = await sitemap();
    for (const slug of ['sp-a', 'sp-b']) {
      const entry = entryOf(out, `/san-pham/${slug}`);
      expect(entry, slug).toBeDefined();
      expect(entry && 'lastModified' in entry, slug).toBe(false);
    }
  });

  it('gian hàng CTV: lastModified từ updatedAt, ngày hỏng thì bỏ chứ không ném lỗi Invalid Date', async () => {
    mocks.getStorefrontList.mockResolvedValue([
      { slug: 'an', updatedAt: '2026-10-20T03:00:00.000Z' },
      { slug: 'bi-hong', updatedAt: 'xxx' },
    ]);
    const out = await sitemap();
    expect(entryOf(out, '/s/an')?.lastModified).toEqual(new Date('2026-10-20T03:00:00.000Z'));
    const broken = entryOf(out, '/s/bi-hong');
    expect(broken).toBeDefined();
    expect(broken && 'lastModified' in broken).toBe(false);
  });

  it('trang chủ, trang tĩnh, nhãn và chính sách không có nguồn ngày thật nên không có lastModified', async () => {
    routeMocks.publicStaticRoutes.mockReturnValueOnce(['/', '/gioi-thieu']);
    mocks.getBrands.mockResolvedValue([{ brand: 'A', count: 1, slug: 'nhan-a' }]);
    mocks.getLegalDoc.mockImplementation(async (slug: string) => ({ content: slug === 'doi-tra' ? '# nội dung' : null, vars: {} }));
    const out = await sitemap();
    for (const e of out) expect('lastModified' in e, e.url).toBe(false);
    expect(out.length).toBeGreaterThanOrEqual(4);
  });
});

describe('sitemap trang chiến dịch (/chien-dich/[slug])', () => {
  const campaignEntries = (out: Awaited<ReturnType<typeof sitemap>>) => out.filter((e) => e.url.includes('/chien-dich/'));

  it('nộp mỗi chiến dịch đang chạy một URL đúng dạng canonical của trang, lastModified từ updatedAt (ngày admin sửa thật)', async () => {
    http.get.mockResolvedValue([
      { slug: 'giua-thu', updatedAt: '2026-11-09T02:00:00.000Z' },
      { slug: 'black-friday', updatedAt: '2026-11-15T10:00:00.000Z' },
    ]);
    const out = await sitemap();
    expect(http.get).toHaveBeenCalledWith('/campaigns/public-slugs', undefined);
    expect(campaignEntries(out)).toEqual([
      { url: 'https://app.tubutree.com/chien-dich/giua-thu', lastModified: new Date('2026-11-09T02:00:00.000Z'), changeFrequency: 'daily', priority: 0.6 },
      { url: 'https://app.tubutree.com/chien-dich/black-friday', lastModified: new Date('2026-11-15T10:00:00.000Z'), changeFrequency: 'daily', priority: 0.6 },
    ]);
  });

  it('API trả rỗng: không có URL chiến dịch, sitemap vẫn đủ phần khác', async () => {
    mocks.getProducts.mockResolvedValueOnce([{ slug: 'sp-a' }]);
    http.get.mockResolvedValue([]);
    const out = await sitemap();
    expect(campaignEntries(out)).toEqual([]);
    expect(entryOf(out, '/san-pham/sp-a')).toBeDefined();
  });

  it('API chưa có endpoint (404, API bản cũ): bỏ qua chiến dịch, không làm hỏng sitemap', async () => {
    http.get.mockRejectedValue(new ApiNotFoundError('/campaigns/public-slugs'));
    const out = await sitemap();
    expect(campaignEntries(out)).toEqual([]);
    expect(out[0]!.url).toBe('https://app.tubutree.com/');
  });

  it('dữ liệu hỏng: bỏ dòng thiếu slug, slug trùng chỉ nộp một lần, ngày hỏng thì bỏ lastModified, thân không phải mảng thì coi như rỗng', async () => {
    http.get.mockResolvedValue([{ slug: 'giua-thu', updatedAt: 'xxx' }, { slug: '' }, { updatedAt: '2026-11-09T02:00:00.000Z' }, null, { slug: 'giua-thu', updatedAt: '2026-11-09T02:00:00.000Z' }]);
    const out = campaignEntries(await sitemap());
    expect(out.map((e) => e.url)).toEqual(['https://app.tubutree.com/chien-dich/giua-thu']);
    expect('lastModified' in out[0]!).toBe(false);
    http.get.mockResolvedValue({ data: [] });
    expect(campaignEntries(await sitemap())).toEqual([]);
  });

  it('slug lạ được mã hoá như canonical của trang (encodeURIComponent)', async () => {
    http.get.mockResolvedValue([{ slug: 'a b/c', updatedAt: '2026-11-09T02:00:00.000Z' }]);
    expect(campaignEntries(await sitemap()).map((e) => e.url)).toEqual(['https://app.tubutree.com/chien-dich/a%20b%2Fc']);
  });

  it('API lỗi tạm (5xx) lúc chạy: ném như mọi danh sách khác để Next giữ sitemap đầy đủ lần trước', async () => {
    http.get.mockRejectedValue(new ApiUnavailableError('/campaigns/public-slugs', 503));
    await expect(sitemap()).rejects.toThrow('không sẵn sàng');
  });
});
