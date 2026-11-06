import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { ReviewsService } from '../../src/modules/reviews/reviews.service';
import { createUser, randCode } from './helpers';

/**
 * Lọc danh sách đánh giá công khai theo sao, ảnh, video chạy trong truy vấn (real Postgres). Trước đây hai app lọc trên 100
 * dòng mới nhất máy chủ trả: sản phẩm có hơn 100 đánh giá 5 sao mới thì chip "1 sao" báo không có đánh giá khớp dù có.
 */
describe('Danh sách đánh giá công khai: lọc ở máy chủ trên mọi đánh giá đang hiện (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reviews: ReviewsService;
  let slug: string;
  let productId: string;

  const IMG = 'https://res.cloudinary.com/tubu/image/upload/v1/it-review.jpg';
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  const VID = 'https://res.cloudinary.com/tubu/video/upload/v1/it-review.mp4';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, ReviewsService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    reviews = moduleRef.get(ReviewsService);

    const tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `it-rf-p-${tag}`, brand: 'IT', slug: `it-rf-${tag.toLowerCase()}`, name: `SP lọc đánh giá ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    slug = p.slug;
    productId = p.id;
    const u = await createUser(prisma);
    const t0 = Date.parse('2026-01-01T00:00:00.000Z');
    // Cũ nhất trước: 3 đánh giá 1 sao (một có ảnh https, một có ảnh base64), 2 đánh giá 2 sao có video, 1 đánh giá 1 sao bị ẩn,
    // rồi 125 đánh giá 5 sao mới hơn. 100 dòng mới nhất toàn là 5 sao.
    const rows = [
      { rating: 1, images: [IMG] },
      { rating: 1, images: [PNG] },
      { rating: 1, images: [] },
      { rating: 2, images: [], videoUrl: VID },
      { rating: 2, images: [], videoUrl: VID },
      { rating: 1, images: [], isVisible: false },
      ...Array.from({ length: 125 }, () => ({ rating: 5, images: [] as string[] })),
    ];
    await prisma.review.createMany({
      data: rows.map((r, i) => ({
        userId: u.id,
        productId: p.id,
        orderId: `it-rf-o-${tag}-${i}`,
        comment: `Đánh giá ${i}`,
        createdAt: new Date(t0 + i * 60_000),
        ...r,
      })),
    });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const STATS = { count: 130, average: 4.9, videoCount: 2, distribution: { 5: 125, 4: 0, 3: 0, 2: 2, 1: 3 } };

  it('không lọc: 100 dòng mới nhất, toàn 5 sao (lọc 1 sao ở client trên danh sách này ra rỗng)', async () => {
    const r = await reviews.listByProduct(slug);
    expect(r.items).toHaveLength(100);
    expect(new Set(r.items.map((i) => i.rating))).toEqual(new Set([5]));
    expect(r).toMatchObject(STATS);
  });

  it('rating=1: đủ 3 đánh giá 1 sao đang hiện, mới nhất trước, không lộ đánh giá đã ẩn; thống kê không đổi', async () => {
    const r = await reviews.listByProduct(slug, { rating: 1 });
    expect(r.items.map((i) => i.comment)).toEqual(['Đánh giá 2', 'Đánh giá 1', 'Đánh giá 0']);
    expect(r.items.every((i) => i.rating === 1)).toBe(true);
    expect(r).toMatchObject(STATS);
  });

  it('rating=2: 2 dòng; rating=3 và 4: rỗng; rating=5: kẹp 100 dòng', async () => {
    expect((await reviews.listByProduct(slug, { rating: 2 })).items.map((i) => i.rating)).toEqual([2, 2]);
    expect((await reviews.listByProduct(slug, { rating: 3 })).items).toEqual([]);
    expect((await reviews.listByProduct(slug, { rating: 4 })).items).toEqual([]);
    const five = await reviews.listByProduct(slug, { rating: 5 });
    expect(five.items).toHaveLength(100);
    expect(five.items.every((i) => i.rating === 5)).toBe(true);
  });

  it('media=photo: 2 đánh giá có ảnh (https giữ nguyên, base64 thành đường dẫn tải ảnh riêng)', async () => {
    const r = await reviews.listByProduct(slug, { media: 'photo' });
    expect(r.items.map((i) => i.comment)).toEqual(['Đánh giá 1', 'Đánh giá 0']);
    expect(r.items[0]!.images[0]).toMatch(/^\/reviews\/[^/]+\/images\/0\?v=[0-9a-f]{10}$/);
    expect(r.items[1]!.images).toEqual([IMG]);
  });

  it('media=video: đúng số trên chip "Có video"', async () => {
    const r = await reviews.listByProduct(slug, { media: 'video' });
    expect(r.items).toHaveLength(r.videoCount);
    expect(r.items.every((i) => i.videoUrl === VID)).toBe(true);
  });

  it('rating=1 + media=photo: chỉ dòng thoả cả hai', async () => {
    const r = await reviews.listByProduct(slug, { rating: 1, media: 'photo' });
    expect(r.items.map((i) => i.comment)).toEqual(['Đánh giá 1', 'Đánh giá 0']);
  });

  it('rating=5 qua 2 trang: trang đầu 100 + nextCursor, trang sau 25 còn lại + nextCursor null; đủ 125, không trùng, đúng thứ tự', async () => {
    const first = await reviews.listByProduct(slug, { rating: 5 });
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await reviews.listByProduct(slug, { rating: 5, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(25);
    expect(second.nextCursor).toBeNull();
    const comments = [...first.items, ...second.items].map((i) => i.comment);
    expect(comments).toEqual(Array.from({ length: 125 }, (_, k) => `Đánh giá ${130 - k}`));
    expect(second).toMatchObject(STATS);
  });

  it('không lọc qua 2 trang: đủ 130 đánh giá đang hiện, không lộ dòng đã ẩn; rating=1 vừa một trang thì nextCursor null', async () => {
    const first = await reviews.listByProduct(slug);
    const second = await reviews.listByProduct(slug, { cursor: first.nextCursor! });
    const ids = [...first.items, ...second.items].map((i) => i.id);
    expect(ids).toHaveLength(130);
    expect(new Set(ids).size).toBe(130);
    expect(second.items.map((i) => i.comment).slice(-6)).toEqual(['Đánh giá 6', 'Đánh giá 4', 'Đánh giá 3', 'Đánh giá 2', 'Đánh giá 1', 'Đánh giá 0']);
    expect((await reviews.listByProduct(slug, { rating: 1 })).nextCursor).toBeNull();
  });

  it('chip số sao đọc theo index (productId, isVisible, rating, createdAt DESC), không đọc mọi đánh giá rồi bỏ dòng khác sao', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = 'reviews_productId_isVisible_rating_createdAt_idx'`;
    expect(rows[0]?.indexdef).toMatch(/\("productId", "isVisible", rating, "createdAt" DESC\)$/);
    await prisma.$executeRawUnsafe('ANALYZE reviews');
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT id FROM reviews WHERE "productId" = $1 AND "isVisible" = true AND rating = 1 ORDER BY "createdAt" DESC LIMIT 100`,
        productId,
      );
    });
    const text = plan.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).toContain('reviews_productId_isVisible_rating_createdAt_idx');
  });
});

/**
 * Phân trang con trỏ (createdAt, id) trên Postgres thật: nhiều đánh giá cùng mili giây (createMany cùng lúc, nhập hàng loạt) không
 * lặp hay sót khi qua trang; đánh giá mới đăng giữa lúc khách đang xem trang 1 không đẩy dòng cũ lặp lại ở trang 2 như offset.
 */
describe('Danh sách đánh giá công khai: phân trang con trỏ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let reviews: ReviewsService;
  let slug: string;
  let productId: string;
  let userId: string;
  let tag: string;
  const t0 = Date.parse('2026-02-01T00:00:00.000Z');

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, ReviewsService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    reviews = moduleRef.get(ReviewsService);
    tag = randCode(8);
    const p = await prisma.product.create({
      data: { pancakeId: `it-rc-p-${tag}`, brand: 'IT', slug: `it-rc-${tag.toLowerCase()}`, name: `SP trang đánh giá ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    slug = p.slug;
    productId = p.id;
    userId = (await createUser(prisma)).id;
    // 230 đánh giá, mỗi 5 dòng chung một mốc mili giây; dòng chẵn 4 sao, dòng lẻ 5 sao.
    await prisma.review.createMany({
      data: Array.from({ length: 230 }, (_, i) => ({
        userId,
        productId,
        orderId: `it-rc-o-${tag}-${i}`,
        rating: i % 2 === 0 ? 4 : 5,
        comment: `Trang ${i}`,
        images: [],
        createdAt: new Date(t0 + Math.floor(i / 5) * 60_000),
      })),
    });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function walk(filter: { rating?: number } = {}) {
    const pages: number[] = [];
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const r = await reviews.listByProduct(slug, { ...filter, cursor });
      pages.push(r.items.length);
      ids.push(...r.items.map((i) => i.id));
      cursor = r.nextCursor ?? undefined;
    } while (cursor && pages.length < 10);
    return { pages, ids };
  }

  it('không lọc: 100 + 100 + 30, đủ 230 dòng không trùng, đúng thứ tự createdAt DESC, id DESC', async () => {
    const { pages, ids } = await walk();
    expect(pages).toEqual([100, 100, 30]);
    expect(new Set(ids).size).toBe(230);
    const all = await prisma.review.findMany({ where: { productId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
    expect(ids).toEqual(all.map((r) => r.id));
  });

  it('rating=4: 100 + 15, chỉ dòng 4 sao, đủ 115 không trùng', async () => {
    const { pages, ids } = await walk({ rating: 4 });
    expect(pages).toEqual([100, 15]);
    expect(new Set(ids).size).toBe(115);
    const four = await prisma.review.count({ where: { productId, rating: 4, id: { in: ids } } });
    expect(four).toBe(115);
  });

  it('đánh giá mới đăng sau khi tải trang 1: trang 2 vẫn nối tiếp đúng chỗ, không lặp dòng của trang 1', async () => {
    const first = await reviews.listByProduct(slug);
    await prisma.review.create({
      data: { userId, productId, orderId: `it-rc-o-${tag}-new`, rating: 5, comment: 'Mới đăng', images: [], createdAt: new Date(t0 + 999 * 60_000) },
    });
    const second = await reviews.listByProduct(slug, { cursor: first.nextCursor! });
    const firstIds = new Set(first.items.map((i) => i.id));
    expect(second.items).toHaveLength(100);
    expect(second.items.some((i) => firstIds.has(i.id))).toBe(false);
    expect(second.items.some((i) => i.comment === 'Mới đăng')).toBe(false);
    expect(second.count).toBe(231);
  });
});
