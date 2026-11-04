import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { storedThumbnailFor } from '../../src/common/public-image';
import { loadFeedImages } from '../../src/modules/feed/feed-images';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { PurchasedItemsService } from '../../src/modules/orders/purchased-items.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { WishlistService } from '../../src/modules/wishlist/wishlist.service';
import { CartService } from '../../src/modules/cart/cart.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { createOrder, createUser, randCode } from './helpers';

/**
 * sec-1104-e: các đường nóng không kéo cột nặng (ảnh base64, văn bản dài, giá sỉ) về Node. SQL thật đi qua Prisma, nên đọc câu
 * lệnh Prisma phát ra thay vì tin vào `select` trong mã.
 */
describe('sec-1104-e: đường đọc nhẹ (real Postgres)', () => {
  const tag = randCode(6).toLowerCase();
  const BIG = Buffer.alloc(40_000, 5).toString('base64');
  const DATA = `data:image/png;base64,${BIG}`;
  let prisma: PrismaClient;
  let queries: string[] = [];
  const ids = { user: '', product: '', variation: '' };

  beforeAll(async () => {
    prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    (prisma as unknown as { $on: (e: 'query', cb: (q: { query: string }) => void) => void }).$on('query', (q) => queries.push(q.query));
    await prisma.$connect();
    const user = await createUser(prisma as unknown as PrismaService);
    ids.user = user.id;
    const product = await prisma.product.create({
      data: {
        brand: `IT ${tag}`, slug: `it-lean-${tag}`, name: `IT lean ${tag}`, description: 'MÔ TẢ DÀI '.repeat(50), ingredients: 'THÀNH PHẦN',
        basePrice: 100_000, approvalStatus: 'APPROVED', isFeatured: true, images: [DATA, 'https://res.cloudinary.com/x/2.jpg'],
        variations: { create: { sku: `IT-LEAN-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, stock: 5, dealerPrices: { tier_silver: 90_000 } } },
      },
      include: { variations: true },
    });
    ids.product = product.id;
    ids.variation = product.variations[0]!.id;
    await prisma.wishlist.create({ data: { userId: user.id, productId: product.id } });
    const cart = await prisma.cart.create({ data: { userId: user.id } });
    await prisma.cartItem.create({ data: { cartId: cart.id, variationId: ids.variation, quantity: 2 } });
  });

  afterAll(async () => {
    await prisma.cartItem.deleteMany({ where: { cart: { userId: ids.user } } });
    await prisma.cart.deleteMany({ where: { userId: ids.user } });
    await prisma.wishlist.deleteMany({ where: { userId: ids.user } });
    await prisma.product.deleteMany({ where: { id: ids.product } });
    await prisma.$disconnect();
  });

  const heavy = (q: string) => /"(description|ingredients|dealerPrices|affiliateRate)"/.test(q) || /"products"\."images"/.test(q);

  it('thẻ (cardsByIds, for-you, yêu thích): không đọc cột nặng; thẻ không có thumbnail vẫn ra ảnh đầu dạng đường dẫn', async () => {
    const catalog = new CatalogService(prisma as unknown as PrismaService);
    queries = [];
    const cards = await catalog.cardsByIds([ids.product]);
    const forYou = await catalog.getForYou(ids.user, { hasOrders: false });
    const wish = await new WishlistService(prisma as unknown as PrismaService).list(ids.user);
    expect(queries.filter((q) => /FROM "(public"\.")?products"/.test(q) && heavy(q))).toEqual([]);
    for (const list of [cards, forYou, wish]) {
      const c = list.find((x) => x.id === ids.product)!;
      expect(c.thumbnail).toMatch(new RegExp(`^/public-image/product/${ids.product}/0\\?v=[0-9a-f]{16}$`));
      expect(c).not.toHaveProperty('description');
    }
  });

  it('giỏ: tính giá đủ dòng mà không đọc description/images/dealerPrices', async () => {
    const stub = { resolveEffective: async () => new Map(), computeWithGroups: async () => ({ total: 0, perLine: {}, groups: [] }), get: async <T>(_k: string, fb?: T) => fb as T };
    const cart = new CartService(prisma as unknown as PrismaService, {} as never, stub as never, stub as never, { record: async () => undefined } as never, stub as never);
    queries = [];
    const priced = await cart.getCartForCheckout(ids.user);
    expect(priced.items).toHaveLength(1);
    expect(priced.items[0]).toMatchObject({ variationId: ids.variation, quantity: 2, unitPrice: 100_000, total: 200_000, productName: `IT lean ${tag}` });
    expect(queries.filter((q) => /FROM "(public"\.")?(products|variations)"/.test(q) && heavy(q))).toEqual([]);
  });

  describe('migration 20261104141000: thumbnail data URL → đường dẫn ảnh đầu', () => {
    const png = (n: number) => `data:image/png;base64,${Buffer.alloc(n, n).toString('base64')}`;
    const made: string[] = [];
    const mk = (suffix: string, thumbnail: string | null, images: string[]) =>
      prisma.product
        .create({ data: { brand: `IT ${tag}`, slug: `it-th-${tag}-${suffix}`, name: `IT th ${suffix}`, description: 'd', basePrice: 1, thumbnail, images } })
        .then((p) => {
          made.push(p.id);
          return p;
        });

    afterAll(async () => {
      await prisma.product.deleteMany({ where: { id: { in: made } } });
    });

    it('dựng đúng chuỗi của storedThumbnailFor; chỉ đổi dòng trùng ảnh đầu; chạy lại không đổi gì', async () => {
      const A = png(300);
      const B = png(400);
      const same = await mk('same', A, [A, B]);
      const diff = await mk('diff', B, [A]);
      const https = await mk('https', 'https://res.cloudinary.com/x/t.jpg', ['https://res.cloudinary.com/x/t.jpg']);
      const svg = await mk('svg', 'data:image/svg+xml;base64,PHN2Zy8+', ['data:image/svg+xml;base64,PHN2Zy8+']);
      const none = await mk('none', null, [A]);

      const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261104141000_product_thumbnail_ref/migration.sql'), 'utf8');
      const statement = sql.replace(/^--.*$/gm, '').trim().replace(/;$/, ''); // một câu UPDATE duy nhất
      for (let run = 0; run < 2; run++) await prisma.$executeRawUnsafe(statement); // lần hai: không đổi gì

      const read = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id }, select: { thumbnail: true, images: true } }));
      expect((await read(same.id)).thumbnail).toBe(storedThumbnailFor(same.id, A));
      expect((await read(same.id)).images).toEqual([A, B]);
      expect((await read(diff.id)).thumbnail).toBe(B);
      expect((await read(https.id)).thumbnail).toBe('https://res.cloudinary.com/x/t.jpg');
      expect((await read(svg.id)).thumbnail).toBe('data:image/svg+xml;base64,PHN2Zy8+');
      expect((await read(none.id)).thumbnail).toBeNull();
    });
  });

  describe('bảng tin: ảnh bìa + số ảnh đọc từ cột tóm tắt (migration 20261104142000)', () => {
    const jpeg = (n: number) => `data:image/jpeg;base64,${Buffer.alloc(n, n).toString('base64')}`;
    const CLOUD = 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg';
    const made: string[] = [];
    let authorId = '';
    let multi = '';
    let cloudFirst = '';
    let empty = '';
    let legacy = '';

    const mk = async (images: string[]) => {
      const post = await prisma.feedPost.create({ data: { userId: authorId, body: `IT ${tag}`, status: 'PUBLISHED', images } });
      made.push(post.id);
      return post.id;
    };
    /** SQL cũ của chế độ chỉ-bìa (unnest/subscript trên cột images), làm chuẩn so sánh. */
    const oldCover = async (ids: string[]) =>
      prisma.$queryRawUnsafe<{ postId: string; count: number; url: string | null; hash: string | null }[]>(
        `SELECT p."id" AS "postId", cardinality(p."images")::int AS "count",
                CASE WHEN c.img ~ '^https?://' THEN c.img END AS "url",
                CASE WHEN c.img LIKE 'data:%' THEN md5(p."id" || ':0:' || c.img) END AS "hash"
         FROM "feed_posts" p CROSS JOIN LATERAL (SELECT p."images"[1] AS img OFFSET 0) c
         WHERE p."id" = ANY($1) AND cardinality(p."images") > 0 ORDER BY p."id"`,
        ids,
      );

    beforeAll(async () => {
      authorId = (await createUser(prisma as unknown as PrismaService)).id;
      multi = await mk([jpeg(300), CLOUD, jpeg(500), jpeg(700)]);
      cloudFirst = await mk([CLOUD, jpeg(200)]);
      empty = await mk([]);
      legacy = await mk(['không-phải-ảnh', CLOUD]);
    });

    afterAll(async () => {
      await prisma.feedPost.deleteMany({ where: { id: { in: made } } });
      await prisma.user.deleteMany({ where: { id: authorId } });
    });

    const ids = () => [multi, cloudFirst, empty, legacy];
    const summary = async (id: string) => prisma.feedPost.findUniqueOrThrow({ where: { id }, select: { imageCount: true, coverRef: true } });

    it('trigger giữ cột tóm tắt khi tạo bài: số ảnh đúng, bìa base64 là md5(id:0:ảnh), bìa https nguyên văn, chuỗi lạ/không ảnh là NULL', async () => {
      expect(await summary(multi)).toEqual({ imageCount: 4, coverRef: expect.stringMatching(/^[0-9a-f]{32}$/) });
      expect(await summary(cloudFirst)).toEqual({ imageCount: 2, coverRef: CLOUD });
      expect(await summary(empty)).toEqual({ imageCount: 0, coverRef: null });
      expect(await summary(legacy)).toEqual({ imageCount: 2, coverRef: null });
    });

    it('danh sách (chỉ-bìa) trả đúng dữ liệu như SQL cũ trên bài nhiều ảnh, và không câu SQL nào chứa "images"', async () => {
      const queries: string[] = [];
      const logged = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
      (logged as unknown as { $on: (e: 'query', cb: (q: { query: string }) => void) => void }).$on('query', (q) => queries.push(q.query));
      await logged.$connect();
      try {
        const out = await loadFeedImages(logged as unknown as PrismaService, ids(), true);
        expect(queries.length).toBeGreaterThan(0);
        expect(queries.filter((q) => q.includes('"images"'))).toEqual([]);
        const expected = new Map<string, { count: number; images: string[] }>();
        for (const r of await oldCover(ids())) {
          expected.set(r.postId, { count: Number(r.count), images: r.url ? [r.url] : r.hash ? [`/feed/posts/${r.postId}/images/0?v=${r.hash}`] : [] });
        }
        expect(out).toEqual(expected);
        expect(out.get(multi)!.count).toBe(4);
        expect(out.has(empty)).toBe(false);
        expect(out.get(legacy)).toEqual({ count: 2, images: [] });
      } finally {
        await logged.$disconnect();
      }
    });

    it('sửa ảnh (Prisma update) và SQL thô dọn ảnh base64 đều làm mới cột tóm tắt; đổi trạng thái không đụng tới', async () => {
      await prisma.feedPost.update({ where: { id: cloudFirst }, data: { images: [jpeg(333)] } });
      const edited = await summary(cloudFirst);
      expect(edited.imageCount).toBe(1);
      expect(edited.coverRef).toMatch(/^[0-9a-f]{32}$/);
      await prisma.$executeRaw`UPDATE "feed_posts" p SET "images" = ARRAY(SELECT i FROM unnest(p."images") AS i WHERE left(i, 5) <> 'data:') WHERE p."id" = ${cloudFirst}`;
      expect(await summary(cloudFirst)).toEqual({ imageCount: 0, coverRef: null });
      await prisma.feedPost.update({ where: { id: multi }, data: { status: 'PENDING' } });
      expect((await summary(multi)).imageCount).toBe(4);
    });

    it('migration backfill: dựng lại hai cột từ images giống trigger, chạy lại không đổi gì', async () => {
      await prisma.$executeRaw`UPDATE "feed_posts" SET "imageCount" = 0, "coverRef" = NULL WHERE "id" = ANY(${made})`;
      const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261104142000_feed_post_image_summary/migration.sql'), 'utf8');
      const backfill = sql.slice(sql.indexOf('UPDATE "feed_posts" p')).trim().replace(/;$/, '');
      const before = await prisma.feedPost.findUniqueOrThrow({ where: { id: multi }, select: { images: true } });
      await prisma.$executeRawUnsafe(backfill);
      const once = await Promise.all(ids().map(summary));
      await prisma.$executeRawUnsafe(backfill);
      expect(await Promise.all(ids().map(summary))).toEqual(once);
      expect(once[0]).toEqual({ imageCount: 4, coverRef: expect.stringMatching(/^[0-9a-f]{32}$/) });
      expect(once[3]).toEqual({ imageCount: 2, coverRef: null });
      expect((await prisma.feedPost.findUniqueOrThrow({ where: { id: multi }, select: { images: true } })).images).toEqual(before.images);
    });
  });

  describe('đơn của khách', () => {
    it('danh sách đơn: không đọc shippingHistory/invoiceRequest, các trường còn lại như cũ; chi tiết đơn vẫn có đủ', async () => {
      const history = [{ status: 'SHIPPING', at: '2026-11-04T01:00:00.000Z' }];
      const order = await createOrder(prisma as unknown as PrismaService, {
        userId: ids.user,
        shippingHistory: history,
        invoiceRequest: { companyName: 'Cty IT', taxCode: '0123456789' },
        items: { create: { variationId: ids.variation, productName: `IT lean ${tag}`, variationName: 'Mặc định', unitPrice: 100_000, quantity: 1, total: 100_000 } as never },
      });
      const cfg = { get: async <T>(_k: string, fb?: T) => fb as T };
      const svc = new OrdersService(prisma as unknown as PrismaService, {} as never, {} as never, {} as never, cfg as never, {} as never, {} as never);
      queries = [];
      const page = await svc.list(ids.user, {}, 1, 20);
      const orderQueries = queries.filter((q) => /FROM "(public"\.")?orders"/.test(q) && /"shippingAddress"/.test(q));
      expect(orderQueries.length).toBeGreaterThan(0);
      expect(orderQueries.filter((q) => q.includes('"shippingHistory"') || q.includes('"invoiceRequest"'))).toEqual([]);
      const row = page.data.find((o) => o.id === order.id)!;
      expect(row).toMatchObject({ code: order.code, status: 'CONFIRMED', total: 100_000, paymentMethod: 'COD', canCancel: expect.any(Boolean) });
      expect(row).not.toHaveProperty('shippingHistory');
      expect(row.items[0]).toMatchObject({ productName: `IT lean ${tag}`, quantity: 1, thumbnail: expect.stringMatching(/^\/public-image\/product\//) });
      const detail = await svc.detailView(ids.user, order.code);
      expect(detail.shippingHistory).toEqual(history);
      expect(detail.invoiceRequest).toEqual({ companyName: 'Cty IT', taxCode: '0123456789' });
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.order.delete({ where: { id: order.id } });
    });

    it('hàng đã mua: không đọc cột images của sản phẩm, thumbnail dự phòng là ảnh đầu', async () => {
      const order = await createOrder(prisma as unknown as PrismaService, {
        userId: ids.user,
        status: 'DELIVERED',
        items: { create: { variationId: ids.variation, productName: `IT lean ${tag}`, variationName: 'Mặc định', unitPrice: 100_000, quantity: 1, total: 100_000 } as never },
      });
      queries = [];
      const out = await new PurchasedItemsService(prisma as unknown as PrismaService).list(ids.user);
      expect(queries.filter((q) => /"products"\."images"/.test(q))).toEqual([]);
      expect(out.items[0]!.thumbnail).toMatch(new RegExp(`^/public-image/product/${ids.product}/0\\?v=[0-9a-f]{16}$`));
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.order.delete({ where: { id: order.id } });
    });
  });
});
