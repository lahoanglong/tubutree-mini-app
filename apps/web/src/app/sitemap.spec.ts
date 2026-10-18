import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getProducts: vi.fn(), getStorefrontList: vi.fn() }));
const routeMocks = vi.hoisted(() => ({ publicStaticRoutes: vi.fn(() => ['/']) }));
vi.mock('@/lib/route-map', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/route-map')>()),
  publicStaticRoutes: routeMocks.publicStaticRoutes,
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getProducts: mocks.getProducts,
  getStorefrontList: mocks.getStorefrontList,
}));

import sitemap from './sitemap';

// API chặn limit > 100 (apps/api/src/common/pagination.ts): gọi limit lớn hơn trả 400 và sitemap 500.
const API_MAX_LIMIT = 100;
const products = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ slug: `sp-${from + i}` }));
const productUrls = (out: Awaited<ReturnType<typeof sitemap>>) => out.filter((e) => e.url.includes('/san-pham/'));

beforeEach(() => {
  mocks.getProducts.mockReset().mockResolvedValue([]);
  mocks.getStorefrontList.mockReset().mockResolvedValue([]);
});

describe('sitemap', () => {
  it('thêm route công khai tĩnh của route map, trang chủ không bị lặp', async () => {
    routeMocks.publicStaticRoutes.mockReturnValueOnce(['/', '/gioi-thieu']);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://app.tubutree.com/gioi-thieu');
    expect(urls.filter((u) => u === 'https://app.tubutree.com/')).toHaveLength(1);
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
