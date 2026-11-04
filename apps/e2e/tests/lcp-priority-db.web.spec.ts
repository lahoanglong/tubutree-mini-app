import { readFileSync } from 'fs';
import path from 'path';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './support/mock-api';
import { seedDatabaseUrl } from './support/a11y-db';
import { writableTempDb } from './support/waste-db';
import { runLcp } from './support/lcp-measure';

/**
 * Web 375×812, /san-pham và Trang chủ: như lcp-priority.web.spec.ts nhưng danh sách do máy chủ web dựng từ DB e2e (thumbnail null), nên mỗi ca gán tạm ảnh cho mọi
 * sản phẩm chưa có ảnh rồi trả lại (chỉ ghi DB tạm, như a11y-db.ts). Trong lúc đó mọi trang server dựng từ sản phẩm thật (Trang chủ, PDP, hub) đều đổi ảnh, nên tệp chỉ
 * thuộc project "Web Customer Thumbs DB" (playwright.config.ts), chạy sau mọi project web khách, và hai ca chạy nối tiếp (cùng ghi một cột).
 * Chạy riêng: `--project="Web Customer Thumbs DB" --no-deps`.
 */
test.use({ viewport: { width: 375, height: 812 } });
test.describe.configure({ mode: 'serial' });

const DB_THUMB = 'https://content.pancake.vn/2-26/lcp-db.jpg';

async function withPrisma<T>(fn: (prisma: { product: { updateMany(args: unknown): Promise<unknown> } }) => Promise<T>): Promise<T | null> {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

const setDbThumbs = (on: boolean) =>
  withPrisma((p) => p.product.updateMany(on ? { where: { thumbnail: null }, data: { thumbnail: DB_THUMB } } : { where: { thumbnail: DB_THUMB }, data: { thumbnail: null } }));

/** Khoá xem trước của bản build (`next build` sinh ngẫu nhiên): gửi kèm header `x-prerender-revalidate` thì Next dựng lại trang ISR ngay, bỏ qua cả cache dữ liệu fetch. */
function previewModeId(): string {
  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../web/.next/prerender-manifest.json'), 'utf8')) as { preview?: { previewModeId?: string } };
  const id = manifest.preview?.previewModeId;
  if (!id) throw new Error('prerender-manifest.json không có preview.previewModeId: Next đổi cách làm mới ISR theo yêu cầu, sửa lại ca Trang chủ');
  return id;
}

/** Dựng lại Trang chủ ISR (bản dựng sẵn có thể từ trước khi gán ảnh, hạn 60–300 giây) rồi trả HTML mới. */
async function regenerateHome(request: APIRequestContext): Promise<string> {
  const res = await request.get('/', { headers: { 'x-prerender-revalidate': previewModeId() } });
  expect(res.status()).toBe(200);
  return res.text();
}

test('LCP Trang chủ 375×812 không banner, không Giờ vàng: kệ Bán chạy nhất là khối ảnh đầu, ảnh ưu tiên trong màn đầu', async ({ page, api }, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer Thumbs DB', 'ca ghi DB chỉ chạy ở project Web Customer Thumbs DB, sau các project web khách');
  const seeded = (await setDbThumbs(true)) !== null;
  test.skip(!seeded, 'DB không phải DB tạm: không gán được ảnh cho sản phẩm');
  try {
    const html = await regenerateHome(page.request);
    expect(html, 'Trang chủ dựng lại chưa có ảnh vừa gán: làm mới ISR không chạy').toContain(path.posix.basename(DB_THUMB));
    await runLcp(page, api, { name: 'Trang chủ không banner', path: '/', ready: '[data-home-block="bestSellers"] img', maxHigh: 2, promos: false });
    await expect(page.locator('[data-home-block="bestSellers"] img[fetchpriority="high"]')).toHaveCount(2);
  } finally {
    await setDbThumbs(false);
    await regenerateHome(page.request);
  }
});

// `minPrice=1` không lọc mất món nào nhưng cho danh sách một khoá bộ nhớ đệm riêng của máy chủ web: ảnh gán tạm không lọt vào bản cache của danh sách thường.
test('LCP Danh mục /san-pham 375×812: ảnh high trong màn đầu, LCP không lazy', async ({ page, api }, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer Thumbs DB', 'ca ghi DB chỉ chạy ở project Web Customer Thumbs DB, sau các project web khách');
  const seeded = (await setDbThumbs(true)) !== null;
  test.skip(!seeded, 'DB không phải DB tạm: không gán được ảnh cho sản phẩm');
  try {
    await runLcp(page, api, { name: 'Danh mục /san-pham', path: '/san-pham?all=1&minPrice=1', ready: '[data-ds="product-tile"]', maxHigh: 4 });
  } finally {
    await setDbThumbs(false);
  }
});
