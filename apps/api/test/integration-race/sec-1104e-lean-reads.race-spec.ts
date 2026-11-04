import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { storedThumbnailFor } from '../../src/common/public-image';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { WishlistService } from '../../src/modules/wishlist/wishlist.service';
import { CartService } from '../../src/modules/cart/cart.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { createUser, randCode } from './helpers';

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
});
