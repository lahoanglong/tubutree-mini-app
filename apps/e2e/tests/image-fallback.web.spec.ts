import path from 'path';
import { expect, test as plain } from '@playwright/test';
import { test, type MockApi } from './support/mock-api';
import { NOISE } from './support/noise-png';
import { seedDatabaseUrl } from './support/a11y-db';
import { writableTempDb } from './support/waste-db';

/**
 * Đường lùi của ảnh đổi cỡ (`{api}/img`): bản đổi cỡ 404 (ảnh đã đổi, không còn trong danh sách) thì thử ảnh gốc đúng một lần; gốc cũng hỏng thì hình lá, không lặp.
 * Ảnh gian hàng ở host lạ không bao giờ đi qua /img (không tốn một lượt 404). Phần cuối chạy trên API thật: ảnh đã đăng ký khác 404, ảnh chưa đăng ký là 404.
 * Ảnh đi qua mock trình duyệt (chặn `/api/img` và host gốc), không phụ thuộc mạng.
 */
test.use({ viewport: { width: 375, height: 812 } });

const rand = Math.random().toString(36).slice(2, 8);
const ORIGINAL = `https://content.pancake.vn/2-26/fb-${rand}.jpg`;
// URL lưu ở máy là ảnh CŨ của sản phẩm; API trả ảnh hiện hành (ORIGINAL): dải phải dùng ảnh hiện hành và không bao giờ đụng tới URL cũ.
const STALE = `https://content.pancake.vn/2-26/fb-cu-${rand}.jpg`;
const SEEN = [{ slug: 'da-xem-fb', name: 'Đã xem FB', thumbnail: STALE, viewedAt: 1_700_000_000_000 }];
const card = { id: 'da-xem-fb', name: 'Đã xem FB', slug: 'da-xem-fb', brand: 'Tubu', thumbnail: ORIGINAL, basePrice: 99_000, salePrice: null, ratingAvg: 0, reviewCount: 0, sold: 0, inStock: true, isFeatured: false, repVariationId: 'v-fb' };

function mockHub(api: MockApi): void {
  api.get('/flash-sales/active', []);
  api.get('/me/wishlist/ids', []);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 350000, itemCount: 0 });
  api.get('/products', (c) => {
    const list = c.call.query.get('slugs') ? [card] : [];
    return { data: list, meta: { page: 1, limit: list.length, total: list.length } };
  });
  api.allowUnmocked('GET /products/best-sellers', 'GET /categories', 'GET /brands', 'GET /me/coupons', 'POST /events');
}

async function openHub(page: import('@playwright/test').Page, seen: unknown[]): Promise<{ requests: string[] }> {
  const requests: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    // Chỉ đếm request của đúng ảnh thẻ đang kiểm (bản đổi cỡ qua /img hoặc chính ảnh gốc), không đếm ảnh khác của trang (ô danh mục, thương hiệu, Bán chạy).
    const viaImg = /\/api\/img\?/.test(u) && new URL(u).searchParams.get('u') === ORIGINAL;
    if (viaImg || u === ORIGINAL || u === STALE || new URL(u).searchParams.get('u') === STALE) requests.push(u);
  });
  await page.addInitScript((s) => {
    try {
      localStorage.setItem('tubu_recently_viewed', JSON.stringify(s));
    } catch {
      /* không có localStorage */
    }
  }, seen);
  await page.goto('/san-pham');
  await expect(page.locator('#browse-recent')).toBeVisible({ timeout: 20_000 });
  return { requests };
}

test.describe('thẻ sản phẩm (dải Đã xem gần đây)', () => {
  test('/img trả 404: lùi về ảnh gốc, ảnh hiện, không hình lá', async ({ page, api }) => {
    mockHub(api);
    await page.route('**/api/img?**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Không tìm thấy ảnh."}' }));
    await page.route(ORIGINAL, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: NOISE }));
    const { requests } = await openHub(page, SEEN);
    const img = page.locator('#browse-recent img').first();
    await expect(img).toHaveAttribute('src', ORIGINAL);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('#browse-recent [data-testid="product-image-fallback"]')).toHaveCount(0);
    expect(requests.filter((u) => u === ORIGINAL)).toHaveLength(1);
    // K6: không một request nào tới URL cũ lưu ở máy.
    expect(requests.filter((u) => u.includes(`fb-cu-${rand}`))).toEqual([]);
  });

  test('cả /img lẫn ảnh gốc đều hỏng: hình lá, tối đa 2 lượt tải ảnh (không lặp)', async ({ page, api }) => {
    mockHub(api);
    await page.route('**/api/img?**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
    await page.route(ORIGINAL, (r) => r.fulfill({ status: 404, body: '' }));
    const { requests } = await openHub(page, SEEN);
    await expect(page.locator('#browse-recent [data-testid="product-image-fallback"]')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(requests.length).toBeLessThanOrEqual(2);
    expect(requests.some((u) => u === ORIGINAL)).toBe(true);
  });
});

test.describe('ảnh đại diện gian hàng ở host lạ', () => {
  test('không bao giờ gọi /img: dùng thẳng ảnh gốc', async ({ page, api }, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer Mobile', 'ghi DB chỉ ở một project');
    const url = seedDatabaseUrl();
    test.skip(!writableTempDb(url), 'DB không phải DB tạm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PrismaClient } = require(path.resolve(__dirname, '../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    const slug = `fb-${rand}`;
    const avatar = `https://evil.example/avatar-${rand}.jpg`;
    try {
      await prisma.storefront.create({ data: { type: 'MERCHANT', slug, title: 'Gian hàng ảnh lạ', avatarUrl: avatar, isPublished: true, publishedAt: new Date() } });
      api.allowUnmocked('GET /products', 'GET /me/coupons', 'POST /events', 'GET /categories', 'GET /brands', 'GET /me/wishlist/ids');
      const imgCalls: string[] = [];
      page.on('request', (r) => {
        if (/\/img\?/.test(r.url())) imgCalls.push(r.url());
      });
      await page.route('https://evil.example/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: NOISE }));
      await page.goto(`/s/${slug}`);
      const img = page.getByTestId('shop-avatar').locator('img');
      await expect(img).toHaveAttribute('src', avatar, { timeout: 20_000 });
      await expect(img).not.toHaveAttribute('srcset', /.+/);
      await page.waitForLoadState('networkidle');
      expect(imgCalls).toEqual([]);
    } finally {
      await prisma.storefront.deleteMany({ where: { slug } });
      await prisma.$disconnect();
    }
  });
});

plain.describe('/img trên API thật', () => {
  plain('ảnh đã đăng ký không bị 404; ảnh chưa đăng ký là 404', async ({ request }, testInfo) => {
    plain.setTimeout(90_000);
    plain.skip(testInfo.project.name !== 'Web Customer', 'ghi DB chỉ ở một project');
    const url = seedDatabaseUrl();
    plain.skip(!writableTempDb(url), 'DB không phải DB tạm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PrismaClient } = require(path.resolve(__dirname, '../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    const reg = `https://content.pancake.vn/2-26/reg-${rand}.jpg`;
    const unreg = `https://content.pancake.vn/2-26/unreg-${rand}.jpg`;
    const api = `http://localhost:${process.env.E2E_API_PORT}/api/img`;
    const get = (u: string) => request.get(`${api}?w=160&u=${encodeURIComponent(u)}`).then((r) => r.status());
    try {
      await prisma.brand.create({ data: { slug: `fb-${rand}`, name: `FB ${rand}`, logoUrl: reg } });
      // Danh sách đăng ký nằm trong bộ nhớ API, nạp lại tối đa mỗi 30 giây khi gặp URL lạ: hỏi lặp tới khi thấy ảnh vừa ghi.
      // Ảnh đã đăng ký thì API đi tải ảnh nguồn ở host Pancake: máy không có mạng ra ngoài trả 502 chứ không phải 404, nên "khác 404" mới là điều kiện đủ ở đây.
      await expect.poll(() => get(reg), { timeout: 60_000, intervals: [1_000, 3_000, 5_000] }).not.toBe(404);
      expect(await get(unreg)).toBe(404);
    } finally {
      await prisma.brand.deleteMany({ where: { slug: `fb-${rand}` } });
      await prisma.$disconnect();
    }
  });
});
