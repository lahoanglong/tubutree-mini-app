import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// @vitest-environment jsdom
// Trang chủ như Mini App: phần công khai render server (có trong HTML cho công cụ tìm kiếm); chi tiết từng khối ở components/home/*.spec.

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http-server', () => ({ createServerHttp: () => ({ get: mocks.get }) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: { get: vi.fn().mockResolvedValue([]) },
  rawCoreHttp: { get: vi.fn().mockResolvedValue([]) },
  setCoreGetInterceptor: vi.fn(),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'loading', useAuthRestoring: () => false }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));

import { homeCopy } from '@tubutree/app-core/home-copy';
import { SUGGEST_PAGE_SIZE } from '@tubutree/app-core/home-layout';
import { vnDateSeed } from '@tubutree/app-core/home-suggest';
import HomePage, { metadata } from './page';

const card = (id: string, name: string) => ({
  id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 200000, salePrice: null, isFeatured: false, inStock: true,
});
const BEST_SELLERS = [card('bs1', 'Sữa rửa mặt bán chạy'), card('bs2', 'Kem dưỡng bán chạy'), card('bs3', 'Tinh dầu bán chạy')];
const pageOf = (data: unknown[]) => ({ data, meta: { page: 1, limit: 6, total: data.length } });
const CATEGORIES = [
  { id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4 },
  { id: 'c-trong', parentId: null, name: 'Danh mục trống', slug: 'trong', image: null, sortOrder: 2, productCount: 0 },
];

let failing: string[] = [];
let bestSellers = BEST_SELLERS;
let combos: unknown[] = [];
const render = async () =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{await HomePage()}</QueryClientProvider>,
  );

beforeEach(() => {
  failing = [];
  bestSellers = BEST_SELLERS;
  combos = [];
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: Record<string, unknown> }) => {
    if (failing.includes(path)) throw new Error('API sập');
    if (path === '/products') {
      if (opts?.query?.sort === 'best_seller_30d') return pageOf(bestSellers);
      if (opts?.query?.sort === 'newest') return pageOf([card('nw', 'Hàng mới nhất')]);
      return pageOf([card('f1', 'Dầu gội bồ kết')]);
    }
    if (path === '/bundles/combos') return combos;
    if (path === '/categories') return CATEGORIES;
    if (path === '/brands') return [{ brand: 'Tubu', count: 3 }];
    if (path === '/config/public') return { freeshipThreshold: 350000, subscribeDiscountPct: 0.17, affiliateWalletMultiplier: 1, cashbackHoldDays: 30 };
    throw new Error(`đường dẫn lạ ${path}`);
  });
});

describe('HomePage — server render phần công khai', () => {
  it('main không ghép max-md:py với sm:py (sm: thắng ở 640-767px)', async () => {
    const out = await render();
    const cls = /<main[^>]*class="([^"]*)"/.exec(out)![1]!;
    expect(cls).not.toMatch(/(^|\s)sm:py-/);
  });

  it('canonical luôn là "/" (danh mục và tìm kiếm đã sang /san-pham)', () => {
    expect(metadata.alternates?.canonical).toBe('/');
  });

  it('hỏi API đúng như Mini App: bán chạy 12 theo best_seller_30d và trang 1 của lưới gợi ý kèm hạt giống ngày VN; không còn nổi bật/mới về riêng', async () => {
    const before = vnDateSeed(Date.now());
    await render();
    const after = vnDateSeed(Date.now());
    const queries = mocks.get.mock.calls.filter(([p]) => p === '/products').map(([, o]) => o?.query as Record<string, unknown>);
    expect(queries).toHaveLength(2);
    expect(queries).toContainEqual({ limit: 12, sort: 'best_seller_30d' });
    const suggest = queries.find((q) => q.page === 1)!;
    expect(suggest).toEqual({ limit: SUGGEST_PAGE_SIZE, page: 1, seed: expect.stringMatching(/^\d{8}$/) });
    expect([before, after]).toContain(suggest.seed);
  });

  it('HTML đầu đã có sản phẩm của kệ Bán chạy và lưới gợi ý, hàng danh mục (ẩn danh mục rỗng) và dải thương hiệu', async () => {
    const out = await render();
    expect(out).toContain('Bán chạy nhất');
    expect(out).toContain('Sữa rửa mặt bán chạy');
    expect(out).toContain('Dầu gội bồ kết');
    expect(out).toContain('Dầu gội');
    expect(out).not.toContain('Danh mục trống');
    expect(out).toContain(homeCopy.journey.title);
  });

  it('kệ Bán chạy nhất có hạng #1..#3 ngay trong HTML đầu (công cụ tìm kiếm thấy thứ hạng)', async () => {
    const out = await render();
    const shelf = out.slice(out.indexOf('aria-label="Bán chạy nhất"'));
    expect(shelf).toContain('#1');
    expect(shelf).toContain('#2');
    expect(shelf).toContain('#3');
    expect(shelf).not.toContain('#4');
  });

  it('HTML đầu: hai combo trùng món với Bán chạy nhất thì kệ Combo có trong HTML và Bán chạy nhất đã bỏ các món đó, hạng bắt đầu từ #4 (không chờ client)', async () => {
    const six = ['bs1', 'bs2', 'bs3', 'bs4', 'bs5', 'bs6'].map((id) => card(id, `Món ${id}`));
    bestSellers = six;
    const item = (c: ReturnType<typeof card>) => ({ productId: c.id, variationId: `v-${c.id}`, maxQty: 1, addonPrice: null, inStock: true, product: { ...c, repVariationId: `v-${c.id}` } });
    const combo = (id: string, a: number, b: number) => ({
      id, kind: 'BUNDLE_PCT', title: `Combo ${id}`, pct: 10, endAt: new Date(Date.now() + 86_400_000).toISOString(), anchorProductId: null, items: [item(six[a]!), item(six[b]!)],
    });
    combos = [combo('c1', 0, 1), combo('c2', 0, 2)];
    const out = await render();
    expect(mocks.get).toHaveBeenCalledWith('/bundles/combos', expect.objectContaining({ query: { limit: 4 } }));
    expect(out).toContain('aria-label="Combo tiết kiệm"');
    const start = out.indexOf('aria-label="Bán chạy nhất"');
    const best = out.slice(start, out.indexOf('data-home-block="combos"', start));
    for (const gone of ['Món bs1', 'Món bs2', 'Món bs3', '#1', '#2', '#3']) expect(best).not.toContain(gone);
    for (const kept of ['Món bs4', 'Món bs5', 'Món bs6', '#4', '#5', '#6']) expect(best).toContain(kept);
  });

  it('bán chạy chỉ có 2 món (dưới tối thiểu 3 của kệ): ẩn cả kệ, không vẽ hạng lẻ', async () => {
    bestSellers = BEST_SELLERS.slice(0, 2);
    const out = await render();
    expect(out).not.toContain('aria-label="Bán chạy nhất"');
    expect(out).not.toContain('#1');
  });

  it('khối khách vãng lai: có ô tìm sang /san-pham?focus=search, chuông không huy hiệu như Mini App, không có Dành cho bạn', async () => {
    const out = await render();
    expect(out).toContain('href="/san-pham?focus=search"');
    expect(out).toContain('aria-label="Thông báo"');
    expect(out).not.toContain('chưa đọc');
    expect(out).not.toContain('Dành cho bạn');
  });

  it('khách vãng lai (chưa có cờ phiên): HTML đầu đã có khối Quà khách mới với số lấy từ cấu hình công khai, để Danh mục không nhảy sau hydrate', async () => {
    const out = await render();
    expect(out).toContain('Quà khách mới');
    expect(out).toContain('Miễn phí giao hàng cho đơn từ 350.000đ');
    expect(out.indexOf('Quà khách mới')).toBeLessThan(out.indexOf('Danh mục'));
  });

  it('cấu hình công khai lỗi: bỏ khối Quà khách mới (không bịa số), phần còn lại vẫn dựng', async () => {
    failing = ['/config/public'];
    const out = await render();
    expect(out).not.toContain('Quà khách mới');
    expect(out).toContain('Bán chạy nhất');
  });

  it('giữ cấu trúc heading: đúng một h1 (font Fraunces), h2 cho từng khối', async () => {
    const out = await render();
    expect(out.match(/<h1[ >]/g)).toHaveLength(1);
    expect(out).toMatch(/<h1[^>]*font-display/);
    expect(out).toContain('Mỹ Phẩm &amp; Tiêu Dùng Sinh Học Thuần Khiết');
    expect(out.indexOf('<h2')).toBeGreaterThan(out.indexOf('<h1'));
  });

  it('một phần API lỗi: trang vẫn dựng, phần lỗi để client tải lại; không ném làm hỏng cả trang', async () => {
    failing = ['/categories', '/brands'];
    const out = await render();
    expect(out).toContain('Bán chạy nhất');
    expect(out).not.toContain('brand=Tubu');
    expect(out).toContain(homeCopy.journey.title);
    expect(out).not.toContain('Dải thương hiệu');
  });

  it('cả ba lưới sản phẩm lỗi lúc Next dựng lại trang: ném để Next giữ bản đã render, không lưu trang rỗng', async () => {
    failing = ['/products', '/categories', '/brands'];
    await expect(render()).rejects.toThrow('API sập');
  });

  it('riêng lúc `next build` (API chưa lên): không ném, trang dựng khung và client tự tải lại', async () => {
    failing = ['/products', '/categories', '/brands'];
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    try {
      const out = await render();
      expect(out.match(/<h1[ >]/g)).toHaveLength(1);
      expect(out).toContain('data-home-block="search"');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
