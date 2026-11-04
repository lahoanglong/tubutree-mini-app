import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import helmet from 'helmet';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { ReviewsController } from '../../src/modules/reviews/reviews.controller';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ReviewsService, reviewImageVersions } from '../../src/modules/reviews/reviews.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { createUser, randCode, warmPool } from './helpers';

/**
 * R2-ENGAGE-3: ảnh đánh giá base64 không nhúng trong JSON danh sách/PDP mà tải riêng qua /reviews/:id/images/:i. Chạy
 * HTTP thật (có helmet như main.ts) để chắc ảnh nạp được cross-origin và danh sách không còn mang base64.
 */
describe('Ảnh đánh giá base64 phục vụ qua endpoint riêng (real Postgres + HTTP)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  const tag = randCode(6).toLowerCase();
  // ~400 nghìn ký tự base64 để mô phỏng ảnh nén thật của miniapp.
  const HEAVY_B64 = Buffer.alloc(300_000, 7).toString('base64');
  const IMAGES = [`data:image/png;base64,${HEAVY_B64}`, 'https://res.cloudinary.com/x/y.jpg'];
  let slug = '';
  let reviewId = '';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      controllers: [ReviewsController],
      providers: [ReviewsService, CatalogService, SystemConfigService, AnalyticsEventsService, LoyaltyService],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.setGlobalPrefix('api');
    await app.init();
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api`;
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);

    const user = await createUser(prisma);
    slug = `it-rvimg-${tag}`;
    const product = await prisma.product.create({
      data: { brand: 'IT Brand', slug, name: `IT review img ${tag}`, description: 'IT', basePrice: 100_000, approvalStatus: 'APPROVED' },
    });
    const review = await prisma.review.create({
      data: {
        userId: user.id, productId: product.id, orderId: `it-order-${tag}`, rating: 5,
        images: IMAGES,
      },
    });
    reviewId = review.id;
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { product: { slug } } });
    await prisma.product.deleteMany({ where: { slug } });
    await app?.close();
  });

  it('danh sách đánh giá nhẹ: không chứa base64, ảnh thứ nhất là đường dẫn, ảnh https giữ nguyên', async () => {
    const res = await fetch(`${base}/products/${slug}/reviews`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text.length).toBeLessThan(2_000);
    const body = JSON.parse(text) as { items: { images: string[] }[] };
    expect(body.items[0]!.images[0]).toMatch(new RegExp(`^/reviews/${reviewId}/images/0\\?v=[0-9a-f]{10}$`));
    expect(body.items[0]!.images[1]).toBe('https://res.cloudinary.com/x/y.jpg');
  });

  it('GET đường dẫn đó trả đúng byte ảnh, cache lâu và cho phép nạp cross-origin dù có helmet', async () => {
    const list = (await (await fetch(`${base}/products/${slug}/reviews`)).json()) as { items: { images: string[] }[] };
    const res = await fetch(`${base}${list.items[0]!.images[0]}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(Buffer.from(HEAVY_B64, 'base64'))).toBe(true);
  });

  it('ảnh https, chỉ số lạ, id lạ → 404; chỉ số không phải số → 400', async () => {
    expect((await fetch(`${base}/reviews/${reviewId}/images/1`)).status).toBe(404);
    expect((await fetch(`${base}/reviews/${reviewId}/images/9`)).status).toBe(404);
    expect((await fetch(`${base}/reviews/khong-co/images/0`)).status).toBe(404);
    expect((await fetch(`${base}/reviews/${reviewId}/images/abc`)).status).toBe(400);
  });

  it('đánh giá bị ẩn thì ảnh cũng không tải được', async () => {
    await prisma.review.update({ where: { id: reviewId }, data: { isVisible: false } });
    expect((await fetch(`${base}/reviews/${reviewId}/images/0`)).status).toBe(404);
    await prisma.review.update({ where: { id: reviewId }, data: { isVisible: true } });
  });

  it('PDP (GET /products/:slug) không nhúng ảnh đánh giá', async () => {
    const catalog = moduleRef.get(CatalogService);
    const pdp = await catalog.getBySlug(slug);
    expect(pdp.reviews).toHaveLength(1);
    expect(JSON.stringify(pdp.reviews)).not.toContain('base64');
    expect(pdp.reviews[0]).not.toHaveProperty('images');
  });

  it('danh sách không đọc cột images của reviews/products: không câu SQL nào chứa "images"; URL ảnh vẫn tải đúng ảnh', async () => {
    const queries: string[] = [];
    const logged = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    (logged as unknown as { $on: (e: 'query', cb: (q: { query: string }) => void) => void }).$on('query', (q) => queries.push(q.query));
    await logged.$connect();
    try {
      const none = {} as never;
      const service = new ReviewsService(logged as unknown as PrismaService, none, none);
      const out = await service.listByProduct(slug);
      expect(queries.length).toBeGreaterThan(0);
      expect(queries.filter((q) => q.includes('"images"'))).toEqual([]);
      expect(out.items[0]!.images[1]).toBe('https://res.cloudinary.com/x/y.jpg');
      const res = await fetch(`${base}${out.items[0]!.images[0]}`);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(HEAVY_B64, 'base64'))).toBe(true);
    } finally {
      await logged.$disconnect();
    }
  });

  it('migration backfill (140500, tách khỏi migration thêm cột): dựng lại imageVersions từ images giống mã ứng dụng ghi (md5 10 ký tự, URL giữ nguyên)', async () => {
    await prisma.$executeRaw`UPDATE "reviews" SET "imageVersions" = '{}' WHERE "id" = ${reviewId}`;
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261104140500_review_image_versions_backfill/migration.sql'), 'utf8');
    const statements = sql.replace(/^--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean);
    for (let run = 0; run < 2; run++) for (const stmt of statements) await prisma.$executeRawUnsafe(stmt); // chạy lại không đổi gì
    const row = await prisma.review.findUnique({ where: { id: reviewId }, select: { imageVersions: true } });
    expect(row!.imageVersions).toEqual(reviewImageVersions(IMAGES));
  });

  it('trigger: insert/update images bằng Prisma và SQL thô đều ra imageVersions bằng mã JS; đổi cột khác không chạm', async () => {
    const versions = async () => (await prisma.review.findUniqueOrThrow({ where: { id: reviewId }, select: { imageVersions: true } })).imageVersions;
    expect(await versions()).toEqual(reviewImageVersions(IMAGES));
    const next = [`data:image/png;base64,${Buffer.alloc(900, 3).toString('base64')}`, 'https://res.cloudinary.com/x/z.jpg', `data:image/jpeg;base64,${Buffer.alloc(50, 9).toString('base64')}`];
    await prisma.review.update({ where: { id: reviewId }, data: { images: next } });
    expect(await versions()).toEqual(reviewImageVersions(next));
    const raw = [`data:image/webp;base64,${Buffer.alloc(70, 4).toString('base64')}`];
    await prisma.$executeRaw`UPDATE "reviews" SET "images" = ${raw}::text[] WHERE "id" = ${reviewId}`;
    expect(await versions()).toEqual(reviewImageVersions(raw));
    await prisma.$executeRaw`UPDATE "reviews" SET "imageVersions" = '{}' WHERE "id" = ${reviewId}`;
    await prisma.review.update({ where: { id: reviewId }, data: { rating: 4 } });
    expect(await versions()).toEqual([]); // đổi cột khác không kích hoạt trigger
    await prisma.review.update({ where: { id: reviewId }, data: { images: IMAGES } });
    expect(await versions()).toEqual(reviewImageVersions(IMAGES));
  });
});
