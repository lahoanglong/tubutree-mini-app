import path from 'path';
import { test as plain } from '@playwright/test';
import { expect, test } from './support/mock-api';
import { firstProduct } from './support/pdp-product';
import { seedDatabaseUrl } from './support/a11y-db';
import { writableTempDb } from './support/waste-db';

/**
 * Web khách: chip lọc đánh giá hỏi máy chủ, máy chủ lọc trên mọi đánh giá đang hiện.
 *
 * Danh sách đầy đủ chỉ có 100 đánh giá mới nhất. Sản phẩm 125 đánh giá 5 sao mới + 3 đánh giá 1 sao cũ: trước đây chip "1 sao"
 * lọc trên 100 dòng đó và báo "Không có đánh giá khớp bộ lọc." dù phân bố sao ghi 3.
 * - Ca giao diện: phần server của Next gọi API thật (sản phẩm có sẵn trong DB e2e), danh sách đánh giá từ trình duyệt đi qua API giả
 *   trả theo tham số như API thật.
 * - Ca API thật: ghi một sản phẩm ẩn (không lên danh mục, không đụng spec khác) kèm 131 đánh giá vào DB tạm của web-gate/CI rồi gọi
 *   thẳng API (ValidationPipe, controller, Postgres).
 */
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;

const review = (id: string, rating: number, extra: Record<string, unknown> = {}) => ({
  id,
  rating,
  comment: `Nhận xét ${id}`,
  images: [] as string[],
  videoUrl: null as string | null,
  createdAt: '2026-09-01T00:00:00.000Z',
  author: `Khách ${id}`,
  verifiedPurchase: true,
  ...extra,
});
const NEWEST = Array.from({ length: 100 }, (_, i) => review(`moi${i}`, 5));
const OLD_ONE_STAR = [review('cu1', 1), review('cu2', 1, { images: ['https://res.cloudinary.com/tubu/image/upload/v1/cu2.jpg'] }), review('cu3', 1)];
const OLD_VIDEO = review('vid1', 4, { videoUrl: 'https://res.cloudinary.com/tubu/video/upload/v1/vid1.mp4' });
const SUMMARY = { average: 4.9, count: 128, videoCount: 1, distribution: { '5': 125, '1': 3 } };

test.describe('Web khách: lọc đánh giá theo sao ở máy chủ', () => {
  test('chip ghi số máy chủ; "1 sao" gửi rating=1 và hiện đủ 3 đánh giá 1 sao cũ; "Có ảnh" gửi media=photo; "Có video" gửi hasVideo=true; "Tất cả" trở lại danh sách mới nhất', async ({ page, api, request }) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    api.get('/flash-sales/active', []);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get(`/products/${p!.slug}`, { variations: p!.variations });
    api.get(`/products/${p!.slug}/related`, []);
    api.get(`/products/${p!.slug}/bought-together`, []);
    api.get('/products/for-you', []);
    api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
    api.get('/me/wishlist/ids', []);
    api.get(`/products/${p!.slug}/reviews`, ({ call }) => {
      const rating = call.query.get('rating');
      if (rating) return { ...SUMMARY, items: OLD_ONE_STAR.filter((r) => r.rating === Number(rating)), nextCursor: null };
      if (call.query.get('media') === 'photo') return { ...SUMMARY, items: OLD_ONE_STAR.filter((r) => r.images.length > 0), nextCursor: null };
      if (call.query.get('hasVideo') === 'true') return { ...SUMMARY, items: [OLD_VIDEO], nextCursor: null };
      return { ...SUMMARY, items: NEWEST, nextCursor: 'c-moi99' };
    });
    await page.goto(`/san-pham/${p!.slug}`);

    const section = page.locator('[data-section="pdp-reviews"]');
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole('heading', { name: 'Đánh giá (128)' })).toBeVisible({ timeout: 15_000 });
    await expect(section.getByText('Nhận xét moi0')).toBeVisible();
    await expect(section.getByRole('button', { name: 'Xem thêm đánh giá' })).toBeVisible();
    await expect(section.getByRole('button', { name: /^Tất cả ?\(128\)$/ })).toBeVisible();
    await expect(section.getByRole('button', { name: /^5 sao ?\(125\)$/ })).toBeVisible();

    await section.getByRole('button', { name: /^1 sao ?\(3\)$/ }).click();
    await expect(section.getByText('Nhận xét cu1')).toBeVisible();
    await expect(section.getByText('Nhận xét cu3')).toBeVisible();
    await expect(section.getByText('Không có đánh giá khớp bộ lọc.')).toHaveCount(0);
    await expect(section.getByText('Nhận xét moi0')).toHaveCount(0);
    await expect(section.getByRole('button', { name: 'Xem thêm đánh giá' })).toHaveCount(0);
    await expect(section.getByRole('heading', { name: 'Đánh giá (128)' })).toBeVisible();
    const queries = () => api.callsTo('GET', `/products/${p!.slug}/reviews`).map((c) => c.query.toString());
    expect(queries()).toContain('rating=1');

    await section.getByRole('button', { name: 'Có ảnh', exact: true }).click();
    await expect(section.getByText('Nhận xét cu2')).toBeVisible();
    await expect(section.getByText('Nhận xét cu1')).toHaveCount(0);
    expect(queries()).toContain('media=photo');

    await section.getByRole('button', { name: /^Có video ?\(1\)$/ }).click();
    await expect(section.getByText('Nhận xét vid1')).toBeVisible();
    await expect(section.getByText('Nhận xét cu2')).toHaveCount(0);
    expect(queries()).toContain('hasVideo=true');
    expect(queries().filter((q) => q.includes('media=video'))).toEqual([]);

    await section.getByRole('button', { name: /^Tất cả ?\(128\)$/ }).click();
    await expect(section.getByText('Nhận xét moi0')).toBeVisible();
  });

  // Mỗi trang máy chủ kèm `nextCursor`; API giả trả trang nhỏ (8 rồi 4 dòng) để thấy chỗ nối sau 1 lần bấm.
  test('"Xem thêm đánh giá" tải trang kế bằng cursor, nối vào cuối, giữ dòng cũ; hết trang thì ẩn nút; đổi chip về trang đầu', async ({ page, api, request }) => {
    const p = await firstProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào');
    const FIRST = Array.from({ length: 8 }, (_, i) => review(`t1-${i}`, 5));
    const SECOND = Array.from({ length: 4 }, (_, i) => review(`t2-${i}`, 4));
    const PAGED = { average: 4.7, count: 12, videoCount: 0, distribution: { '5': 8, '4': 4 } };
    api.get('/flash-sales/active', []);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get(`/products/${p!.slug}`, { variations: p!.variations });
    api.get(`/products/${p!.slug}/related`, []);
    api.get(`/products/${p!.slug}/bought-together`, []);
    api.get('/products/for-you', []);
    api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
    api.get('/me/wishlist/ids', []);
    api.get(`/products/${p!.slug}/reviews`, ({ call }) => {
      const cursor = call.query.get('cursor');
      if (call.query.get('rating') === '4') return { ...PAGED, items: cursor ? [] : SECOND, nextCursor: null };
      if (cursor === 'c-t1-7') return { ...PAGED, items: SECOND, nextCursor: null };
      return { ...PAGED, items: FIRST, nextCursor: 'c-t1-7' };
    });
    await page.goto(`/san-pham/${p!.slug}`);

    const section = page.locator('[data-section="pdp-reviews"]');
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByText('Nhận xét t1-0')).toBeVisible({ timeout: 15_000 });
    const rows = section.locator('li').filter({ hasText: /Nhận xét t\d-\d/ });
    await expect(rows).toHaveCount(5);
    const more = section.getByRole('button', { name: 'Xem thêm đánh giá' });
    const queries = () => api.callsTo('GET', `/products/${p!.slug}/reviews`).map((c) => c.query.toString());
    expect(queries().filter((q) => q.includes('cursor'))).toEqual([]);

    await more.click();
    await expect(section.getByText('Nhận xét t2-0')).toBeVisible();
    expect(queries().filter((q) => q.includes('cursor'))).toEqual(['cursor=c-t1-7']);
    await expect(rows).toHaveCount(10);
    await expect(section.getByText('Nhận xét t1-0')).toBeVisible();
    await more.click();
    await expect(rows).toHaveCount(12);
    await expect(rows.last()).toContainText('Nhận xét t2-3');
    await expect(more).toHaveCount(0);

    await section.getByRole('button', { name: /^4 sao ?\(4\)$/ }).click();
    await expect(rows).toHaveCount(4);
    await section.getByRole('button', { name: /^Tất cả ?\(12\)$/ }).click();
    await expect(rows).toHaveCount(5);
    await expect(more).toBeVisible();
  });
});

plain.describe('API thật: GET /products/:slug/reviews lọc trên mọi đánh giá đang hiện', () => {
  plain('?rating=1 trả đủ 3 đánh giá 1 sao cũ khi 100 dòng mới nhất toàn 5 sao; media lọc ảnh/video, hasVideo lọc video; tham số sai trả 400; cursor lấy trang kế', async ({ request }) => {
    const url = seedDatabaseUrl();
    if (process.env.GITHUB_ACTIONS === 'true') expect(writableTempDb(url), 'job CI phải ghi được DB tạm của nó').toBe(true);
    plain.skip(!writableTempDb(url), 'DB không phải DB tạm của web-gate hay CI: không ghi');
    // apps/e2e không phụ thuộc @prisma/client: nạp bản của apps/api (đã generate).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PrismaClient } = require(path.resolve(__dirname, '../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const VID = 'https://res.cloudinary.com/tubu/video/upload/v1/e2e-review.mp4';
    const IMG = 'https://res.cloudinary.com/tubu/image/upload/v1/e2e-review.jpg';
    // Sản phẩm ẩn: không lên danh mục hay "sản phẩm đầu tiên" của spec khác; danh sách đánh giá chỉ tra theo slug.
    const product = await prisma.product.create({
      data: { pancakeId: `e2e-rf-${tag}`, brand: 'E2E', slug: `e2e-loc-danh-gia-${tag}`, name: `E2E lọc đánh giá ${tag}`, description: 'E2E', basePrice: 100_000, isActive: false },
    });
    const user = await prisma.user.create({ data: { referralCode: `RF${tag}`.slice(0, 16).toUpperCase(), fullName: 'Khách E2E' } });
    try {
      const rows = [
        { rating: 1, images: [IMG] },
        { rating: 1, images: [] as string[] },
        { rating: 1, images: [] as string[] },
        { rating: 2, images: [] as string[], videoUrl: VID },
        { rating: 1, images: [] as string[], isVisible: false },
        ...Array.from({ length: 125 }, () => ({ rating: 5, images: [] as string[] })),
      ];
      const t0 = Date.parse('2026-01-01T00:00:00.000Z');
      await prisma.review.createMany({
        data: rows.map((r, i) => ({ userId: user.id, productId: product.id, orderId: `e2e-rf-${tag}-${i}`, comment: `E2E ${i}`, createdAt: new Date(t0 + i * 60_000), ...r })),
      });
      const get = (qs: string) => request.get(`${API_ORIGIN}/api/products/${product.slug}/reviews${qs}`);
      type Body = {
        count: number;
        videoCount: number;
        distribution: Record<string, number>;
        items: { id: string; rating: number; comment: string; videoUrl: string | null; images: string[] }[];
        nextCursor: string | null;
      };

      const all = await get('');
      expect(all.status()).toBe(200);
      const allBody = (await all.json()) as Body;
      expect(allBody.items).toHaveLength(100);
      expect(new Set(allBody.items.map((i) => i.rating))).toEqual(new Set([5]));
      expect(allBody).toMatchObject({ count: 129, videoCount: 1, distribution: { '5': 125, '2': 1, '1': 3 } });

      const one = (await (await get('?rating=1')).json()) as Body;
      expect(one.items.map((i) => i.comment)).toEqual(['E2E 2', 'E2E 1', 'E2E 0']);
      expect(one).toMatchObject({ count: 129, distribution: { '5': 125, '2': 1, '1': 3 } });

      expect(((await (await get('?media=photo')).json()) as Body).items.map((i) => i.images)).toEqual([[IMG]]);
      expect(((await (await get('?hasVideo=true')).json()) as Body).items.map((i) => i.videoUrl)).toEqual([VID]);
      // Bản Mini App cũ (trước W35) còn gửi media=video.
      expect(((await (await get('?media=video')).json()) as Body).items.map((i) => i.videoUrl)).toEqual([VID]);
      expect(((await (await get('?rating=3')).json()) as Body).items).toEqual([]);
      for (const bad of ['?rating=9', '?rating=abc', '?media=audio', '?hasVideo=abc', '?cursor=khong-hop-le']) expect((await get(bad)).status(), bad).toBe(400);

      // Phân trang con trỏ: 129 đánh giá đang hiện = 100 + 29; rating=5: 100 + 25. Không trùng, không sót, trang cuối nextCursor null.
      expect(allBody.nextCursor).toEqual(expect.any(String));
      const rest = (await (await get(`?cursor=${encodeURIComponent(allBody.nextCursor!)}`)).json()) as Body;
      expect(rest.items).toHaveLength(29);
      expect(rest.nextCursor).toBeNull();
      expect(new Set([...allBody.items, ...rest.items].map((i) => i.id)).size).toBe(129);
      expect(rest.items.at(-1)!.comment).toBe('E2E 0');
      const five = (await (await get('?rating=5')).json()) as Body;
      const fiveRest = (await (await get(`?rating=5&cursor=${encodeURIComponent(five.nextCursor!)}`)).json()) as Body;
      expect([five.items.length, fiveRest.items.length, fiveRest.nextCursor]).toEqual([100, 25, null]);
      expect(fiveRest.items.every((i) => i.rating === 5)).toBe(true);
      expect(one.nextCursor).toBeNull();
    } finally {
      await prisma.review.deleteMany({ where: { productId: product.id } });
      await prisma.product.delete({ where: { id: product.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.$disconnect();
    }
  });
});
