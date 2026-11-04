import path from 'path';
import { test } from './support/mock-api';
import { seedDatabaseUrl } from './support/a11y-db';
import { writableTempDb } from './support/waste-db';
import { runLcp } from './support/lcp-measure';

/**
 * Web 375×812, /san-pham: như lcp-priority.web.spec.ts nhưng danh sách do máy chủ web dựng từ DB e2e (thumbnail null), nên ca này gán tạm ảnh cho mọi sản phẩm chưa
 * có ảnh rồi trả lại (chỉ ghi DB tạm, như a11y-db.ts). Trong lúc đó mọi trang server dựng từ sản phẩm thật (Trang chủ, PDP, hub) đều đổi ảnh, nên tệp chỉ thuộc
 * project "Web Customer Thumbs DB" (playwright.config.ts), chạy sau mọi project web khách. Chạy riêng: `--project="Web Customer Thumbs DB" --no-deps`.
 * Ngưỡng ảnh high tối đa 4 (PRIORITY_CARDS).
 */
test.use({ viewport: { width: 375, height: 812 } });

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
