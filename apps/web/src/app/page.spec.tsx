import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// @vitest-environment jsdom
// Trang chủ như Mini App: phần công khai render server (có trong HTML cho công cụ tìm kiếm); chi tiết từng khối ở components/home/*.spec.

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http-server', () => ({ createServerHttp: () => ({ get: mocks.get }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'loading', useAuthRestoring: () => false }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { homeCopy } from '@tubutree/app-core/home-copy';
import { SUGGEST_PAGE_SIZE } from '@tubutree/app-core/home-layout';
import HomePage, { metadata } from './page';

const card = (id: string, name: string) => ({
  id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 200000, salePrice: null, isFeatured: false, inStock: true,
});
const pageOf = (data: unknown[]) => ({ data, meta: { page: 1, limit: 6, total: data.length } });
const CATEGORIES = [
  { id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4 },
  { id: 'c-trong', parentId: null, name: 'Danh mục trống', slug: 'trong', image: null, sortOrder: 2, productCount: 0 },
];

let failing: string[] = [];
const render = async () =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{await HomePage()}</QueryClientProvider>,
  );

beforeEach(() => {
  failing = [];
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: Record<string, unknown> }) => {
    if (failing.includes(path)) throw new Error('API sập');
    if (path === '/products') {
      if (opts?.query?.sort === 'best_seller') return pageOf([card('bs', 'Bán chạy nhất')]);
      if (opts?.query?.sort === 'newest') return pageOf([card('nw', 'Hàng mới nhất')]);
      return pageOf([card('f1', 'Dầu gội bồ kết')]);
    }
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

  it('hỏi API đúng như Mini App: bán chạy 6 theo best_seller và trang 1 của lưới gợi ý; không còn nổi bật/mới về riêng', async () => {
    await render();
    const queries = mocks.get.mock.calls.filter(([p]) => p === '/products').map(([, o]) => o?.query);
    expect(queries).toHaveLength(2);
    expect(queries).toEqual(expect.arrayContaining([{ limit: 6, sort: 'best_seller' }, { limit: SUGGEST_PAGE_SIZE, page: 1 }]));
  });

  it('HTML đầu đã có sản phẩm của kệ Bán chạy và lưới gợi ý, hàng danh mục (ẩn danh mục rỗng) và dải thương hiệu', async () => {
    const out = await render();
    expect(out).toContain('Bán chạy nhất');
    expect(out).toContain('Dầu gội bồ kết');
    expect(out).toContain('Dầu gội');
    expect(out).not.toContain('Danh mục trống');
    expect(out).toContain(homeCopy.journey.title);
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
    expect(out).toContain('Đặt định kỳ giảm 17% mỗi đơn');
    expect(out).toContain('350.000');
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
